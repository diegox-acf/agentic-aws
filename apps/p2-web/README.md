# p2-web

Static Next.js frontend for the P1 shortener, served from S3 through CloudFront.
Tutorial: [docs/03-p2-static-frontend.md](../../docs/03-p2-static-frontend.md), decision: [ADR-0003](../../docs/adr/0003-p2-s3-oac-origin-and-cors.md).

```bash
pnpm install
pnpm test            # Vitest + Testing Library (pnpm test:coverage for the 80% gate)
pnpm typecheck && pnpm lint

# The API URL is baked in at build time.
export NEXT_PUBLIC_API_URL=$(cd ../../infra/live/dev/p1-shortener/api && terragrunt output -raw api_endpoint)
pnpm dev             # http://localhost:3000 (allowed by the API's CORS)
pnpm build           # static export -> out/
```
