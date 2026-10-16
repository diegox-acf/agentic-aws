// Package store implements links.Store on DynamoDB.
package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/expression"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"agentic-aws/p1-shortener/internal/links"
)

// Attribute names. "code" is the table's hash key and "expiresAt" its TTL attribute, both set in
// infra/live/dev/p1-shortener/table/terragrunt.hcl.
const (
	attrCode      = "code"
	attrClicks    = "clicks"
	attrExpiresAt = "expiresAt"
)

// API is the subset of *dynamodb.Client the store uses, so tests can pass a fake.
type API interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// Dynamo is a links.Store backed by one DynamoDB table keyed by code.
type Dynamo struct {
	client API
	table  string
}

var _ links.Store = (*Dynamo)(nil)

// NewDynamo returns a store for table. Production code passes a *dynamodb.Client.
func NewDynamo(client API, table string) *Dynamo {
	return &Dynamo{client: client, table: table}
}

// item is the DynamoDB shape of a links.Link. It lives here, not on links.Link, so the domain
// does not depend on storage attribute names.
type item struct {
	Code      string    `dynamodbav:"code"`
	URL       string    `dynamodbav:"url"`
	Clicks    int64     `dynamodbav:"clicks"`
	CreatedAt time.Time `dynamodbav:"createdAt"` // RFC 3339 string
	// TTL only acts on a Number of epoch seconds; a string date would be silently ignored.
	ExpiresAt time.Time `dynamodbav:"expiresAt,unixtime"`
}

func toItem(l links.Link) item {
	return item{Code: l.Code, URL: l.URL, Clicks: l.Clicks, CreatedAt: l.CreatedAt, ExpiresAt: l.ExpiresAt}
}

func (it item) toLink() links.Link {
	return links.Link{Code: it.Code, URL: it.URL, Clicks: it.Clicks, CreatedAt: it.CreatedAt, ExpiresAt: it.ExpiresAt}
}

// Create stores link, or returns links.ErrCodeTaken if its code already exists. PutItem alone
// would overwrite the existing item, so the write is conditional.
func (d *Dynamo) Create(ctx context.Context, link links.Link) error {
	av, err := attributevalue.MarshalMap(toItem(link))
	if err != nil {
		return fmt.Errorf("marshal link %s: %w", link.Code, err)
	}
	expr, err := expression.NewBuilder().
		WithCondition(expression.AttributeNotExists(expression.Name(attrCode))).
		Build()
	if err != nil {
		return fmt.Errorf("build create expression: %w", err)
	}
	_, err = d.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:                 aws.String(d.table),
		Item:                      av,
		ConditionExpression:       expr.Condition(),
		ExpressionAttributeNames:  expr.Names(),
		ExpressionAttributeValues: expr.Values(),
	})
	if isConditionFailed(err) {
		return links.ErrCodeTaken
	}
	if err != nil {
		return fmt.Errorf("put link %s: %w", link.Code, err)
	}
	return nil
}

// Get returns the link for code, expired or not, or links.ErrNotFound.
func (d *Dynamo) Get(ctx context.Context, code string) (links.Link, error) {
	out, err := d.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(d.table),
		Key:       keyOf(code),
		// Reads are eventually consistent by default, so stats requested right after create
		// could 404. A strongly consistent read costs 1 RCU instead of 0.5.
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return links.Link{}, fmt.Errorf("get link %s: %w", code, err)
	}
	if len(out.Item) == 0 {
		return links.Link{}, links.ErrNotFound
	}
	return decode(out.Item)
}

// IncrementClicks atomically adds one click and returns the updated link. It returns
// links.ErrNotFound if code does not exist or has expired: the TTL sweep deletes items
// eventually, not at expiresAt, so the expiry check is part of the write.
func (d *Dynamo) IncrementClicks(ctx context.Context, code string, now time.Time) (links.Link, error) {
	// UpdateItem is an upsert; without attribute_exists it would create an item for any code.
	notExpired := expression.Name(attrExpiresAt).GreaterThan(expression.Value(now.Unix()))
	expr, err := expression.NewBuilder().
		WithUpdate(expression.Add(expression.Name(attrClicks), expression.Value(1))).
		WithCondition(expression.AttributeExists(expression.Name(attrCode)).And(notExpired)).
		Build()
	if err != nil {
		return links.Link{}, fmt.Errorf("build increment expression: %w", err)
	}
	out, err := d.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:                 aws.String(d.table),
		Key:                       keyOf(code),
		UpdateExpression:          expr.Update(),
		ConditionExpression:       expr.Condition(),
		ExpressionAttributeNames:  expr.Names(),
		ExpressionAttributeValues: expr.Values(),
		// ALL_NEW returns the whole item; UPDATED_NEW would return only clicks, without the url.
		ReturnValues: types.ReturnValueAllNew,
	})
	if isConditionFailed(err) {
		return links.Link{}, links.ErrNotFound
	}
	if err != nil {
		return links.Link{}, fmt.Errorf("increment clicks %s: %w", code, err)
	}
	return decode(out.Attributes)
}

func keyOf(code string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{attrCode: &types.AttributeValueMemberS{Value: code}}
}

func decode(av map[string]types.AttributeValue) (links.Link, error) {
	var it item
	if err := attributevalue.UnmarshalMap(av, &it); err != nil {
		return links.Link{}, fmt.Errorf("unmarshal link: %w", err)
	}
	return it.toLink(), nil
}

func isConditionFailed(err error) bool {
	var ccf *types.ConditionalCheckFailedException
	return errors.As(err, &ccf)
}
