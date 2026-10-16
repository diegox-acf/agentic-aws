package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/go-cmp/cmp"

	"agentic-aws/p1-shortener/internal/links"
)

const testTable = "links-test"

var (
	errBoom         = errors.New("boom: throttled")
	errCondition    = &types.ConditionalCheckFailedException{Message: aws.String("The conditional request failed")}
	sampleCreatedAt = time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	sampleLink      = links.Link{
		Code:      "aB3xY9z",
		URL:       "https://aws.amazon.com/dynamodb/",
		Clicks:    0,
		CreatedAt: sampleCreatedAt,
		ExpiresAt: sampleCreatedAt.Add(links.TTL),
	}
)

// fakeAPI records the last input of each call and returns the canned output or error.
type fakeAPI struct {
	err error

	put    *dynamodb.PutItemInput
	get    *dynamodb.GetItemInput
	update *dynamodb.UpdateItemInput

	getItem          map[string]types.AttributeValue
	updateAttributes map[string]types.AttributeValue
}

func (f *fakeAPI) PutItem(_ context.Context, in *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	f.put = in
	if f.err != nil {
		return nil, f.err
	}
	return &dynamodb.PutItemOutput{}, nil
}

func (f *fakeAPI) GetItem(_ context.Context, in *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	f.get = in
	if f.err != nil {
		return nil, f.err
	}
	return &dynamodb.GetItemOutput{Item: f.getItem}, nil
}

func (f *fakeAPI) UpdateItem(_ context.Context, in *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	f.update = in
	if f.err != nil {
		return nil, f.err
	}
	return &dynamodb.UpdateItemOutput{Attributes: f.updateAttributes}, nil
}

// storedItem runs sampleLink through Create and returns the item DynamoDB would have stored.
func storedItem(t *testing.T, link links.Link) map[string]types.AttributeValue {
	t.Helper()
	api := &fakeAPI{}
	if err := NewDynamo(api, testTable).Create(context.Background(), link); err != nil {
		t.Fatalf("Create: %v", err)
	}
	return api.put.Item
}

// plain turns attribute values into "S:..." / "N:..." strings so tests can compare them.
func plain(t *testing.T, av map[string]types.AttributeValue) map[string]string {
	t.Helper()
	out := map[string]string{}
	for k, v := range av {
		switch x := v.(type) {
		case *types.AttributeValueMemberS:
			out[k] = "S:" + x.Value
		case *types.AttributeValueMemberN:
			out[k] = "N:" + x.Value
		default:
			t.Fatalf("attribute %s has unexpected type %T", k, v)
		}
	}
	return out
}

// resolve substitutes the #name and :value placeholders the expression builder generates,
// so a test can assert "attribute_not_exists (code)" instead of "attribute_not_exists (#0)".
func resolve(t *testing.T, expr *string, names map[string]string, values map[string]types.AttributeValue) string {
	t.Helper()
	if expr == nil {
		return ""
	}
	var pairs []string
	for k, v := range names {
		pairs = append(pairs, k, v)
	}
	for k, v := range plain(t, values) {
		pairs = append(pairs, k, v[2:]) // drop the "S:" / "N:" prefix
	}
	return strings.NewReplacer(pairs...).Replace(*expr)
}

func TestCreate(t *testing.T) {
	t.Run("stores the item under a condition so codes are never overwritten", func(t *testing.T) {
		api := &fakeAPI{}

		err := NewDynamo(api, testTable).Create(context.Background(), sampleLink)

		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if got := aws.ToString(api.put.TableName); got != testTable {
			t.Errorf("TableName = %q, want %q", got, testTable)
		}
		wantItem := map[string]string{
			"code":      "S:aB3xY9z",
			"url":       "S:https://aws.amazon.com/dynamodb/",
			"clicks":    "N:0",
			"createdAt": "S:2026-10-14T12:00:00Z",
			// TTL only reads a Number of epoch seconds: 2026-11-13T12:00:00Z.
			"expiresAt": "N:1794571200",
		}
		if diff := cmp.Diff(wantItem, plain(t, api.put.Item)); diff != "" {
			t.Errorf("item mismatch (-want +got):\n%s", diff)
		}
		cond := resolve(t, api.put.ConditionExpression, api.put.ExpressionAttributeNames, api.put.ExpressionAttributeValues)
		if cond != "attribute_not_exists (code)" {
			t.Errorf("ConditionExpression = %q, want attribute_not_exists (code)", cond)
		}
	})

	tests := []struct {
		name    string
		apiErr  error
		wantIs  error
		notWant error
	}{
		{"condition failed means the code is taken", errCondition, links.ErrCodeTaken, nil},
		{"other errors are wrapped, not mistaken for a collision", errBoom, errBoom, links.ErrCodeTaken},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := NewDynamo(&fakeAPI{err: tt.apiErr}, testTable).Create(context.Background(), sampleLink)

			if !errors.Is(err, tt.wantIs) {
				t.Errorf("err = %v, want errors.Is %v", err, tt.wantIs)
			}
			if tt.notWant != nil && errors.Is(err, tt.notWant) {
				t.Errorf("err = %v, must not be %v", err, tt.notWant)
			}
		})
	}
}

func TestGet(t *testing.T) {
	t.Run("round-trips the stored item with a strongly consistent read", func(t *testing.T) {
		api := &fakeAPI{getItem: storedItem(t, sampleLink)}

		got, err := NewDynamo(api, testTable).Get(context.Background(), "aB3xY9z")

		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if diff := cmp.Diff(sampleLink, got); diff != "" {
			t.Errorf("link mismatch (-want +got):\n%s", diff)
		}
		if diff := cmp.Diff(map[string]string{"code": "S:aB3xY9z"}, plain(t, api.get.Key)); diff != "" {
			t.Errorf("key mismatch (-want +got):\n%s", diff)
		}
		if !aws.ToBool(api.get.ConsistentRead) {
			t.Error("ConsistentRead = false, want true (stats right after create must not 404)")
		}
	})

	t.Run("missing item is ErrNotFound", func(t *testing.T) {
		_, err := NewDynamo(&fakeAPI{}, testTable).Get(context.Background(), "aB3xY9z")

		if !errors.Is(err, links.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("API errors are wrapped, never ErrNotFound", func(t *testing.T) {
		_, err := NewDynamo(&fakeAPI{err: errBoom}, testTable).Get(context.Background(), "aB3xY9z")

		if !errors.Is(err, errBoom) || errors.Is(err, links.ErrNotFound) {
			t.Errorf("err = %v, want wrapped errBoom", err)
		}
	})

	t.Run("an item with the wrong shape is an error", func(t *testing.T) {
		api := &fakeAPI{getItem: map[string]types.AttributeValue{
			"code":   &types.AttributeValueMemberS{Value: "aB3xY9z"},
			"clicks": &types.AttributeValueMemberS{Value: "not a number"},
		}}

		_, err := NewDynamo(api, testTable).Get(context.Background(), "aB3xY9z")

		if err == nil || errors.Is(err, links.ErrNotFound) {
			t.Errorf("err = %v, want an unmarshal error", err)
		}
	})
}

func TestIncrementClicks(t *testing.T) {
	now := sampleCreatedAt.Add(time.Hour)

	t.Run("adds one under an exists-and-not-expired condition and returns the whole item", func(t *testing.T) {
		clicked := sampleLink
		clicked.Clicks = 8
		api := &fakeAPI{updateAttributes: storedItem(t, clicked)}

		got, err := NewDynamo(api, testTable).IncrementClicks(context.Background(), "aB3xY9z", now)

		if err != nil {
			t.Fatalf("IncrementClicks: %v", err)
		}
		if diff := cmp.Diff(clicked, got); diff != "" {
			t.Errorf("link mismatch (-want +got):\n%s", diff)
		}
		in := api.update
		if diff := cmp.Diff(map[string]string{"code": "S:aB3xY9z"}, plain(t, in.Key)); diff != "" {
			t.Errorf("key mismatch (-want +got):\n%s", diff)
		}
		if got := resolve(t, in.UpdateExpression, in.ExpressionAttributeNames, in.ExpressionAttributeValues); got != "ADD clicks 1\n" {
			t.Errorf("UpdateExpression = %q, want ADD clicks 1", got)
		}
		wantCond := "(attribute_exists (code)) AND (expiresAt > 1791982800)" // now = 2026-10-14T13:00:00Z
		if got := resolve(t, in.ConditionExpression, in.ExpressionAttributeNames, in.ExpressionAttributeValues); got != wantCond {
			t.Errorf("ConditionExpression = %q, want %q", got, wantCond)
		}
		if in.ReturnValues != types.ReturnValueAllNew {
			t.Errorf("ReturnValues = %q, want ALL_NEW (the redirect needs the url)", in.ReturnValues)
		}
	})

	t.Run("condition failed (missing or expired) is ErrNotFound", func(t *testing.T) {
		_, err := NewDynamo(&fakeAPI{err: errCondition}, testTable).IncrementClicks(context.Background(), "aB3xY9z", now)

		if !errors.Is(err, links.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("API errors are wrapped, never ErrNotFound", func(t *testing.T) {
		_, err := NewDynamo(&fakeAPI{err: errBoom}, testTable).IncrementClicks(context.Background(), "aB3xY9z", now)

		if !errors.Is(err, errBoom) || errors.Is(err, links.ErrNotFound) {
			t.Errorf("err = %v, want wrapped errBoom", err)
		}
	})
}
