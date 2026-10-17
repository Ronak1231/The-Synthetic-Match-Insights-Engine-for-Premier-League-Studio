# Switching to Azure later

The agents never call a provider directly. They use an LLM client and a store chosen in
`backend/app/config.py` from environment variables, so moving to Azure is configuration.
Nothing in this repository has been run against Azure yet: treat each step as untested and verify it.

| Concern | Today (free hosts) | Azure option | Environment change |
|---|---|---|---|
| LLM | GitHub Models | Azure OpenAI / Microsoft Foundry deployment | `LLM_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` |
| Database | Neon Postgres | Cosmos DB (NoSQL API) | `STORE_PROVIDER=cosmos`, `COSMOS_ENDPOINT`, `COSMOS_KEY`; `pip install azure-cosmos` |
| Backend hosting | Render | Azure Container Apps | build `backend/Dockerfile`, set the same variables on the app |
| Frontend hosting | Vercel | Azure Static Web Apps | build `frontend`, set `VITE_API_URL` at build time |

## Steps
1. **LLM.** Create an Azure OpenAI (Foundry) resource and a chat model deployment. Set the three `AZURE_OPENAI_*`
   variables and `LLM_PROVIDER=azure`. The client calls `{endpoint}/openai/v1/chat/completions` with an `api-key`
   header and the deployment name as the model. Check that route against your resource in the Azure portal; if your
   resource needs a different path or `api-version`, adjust `build_llm` in `backend/app/llm/base.py`.
2. **Database.** Create a Cosmos DB account, install `azure-cosmos`, set `STORE_PROVIDER=cosmos`. The container is created
   on first start with partition key `/pk`. Bundles are about 400 KB, below the 2 MB item limit.
3. **Hosting.** `az containerapp up --source backend` (or build the Dockerfile and push to a registry). Scale to zero
   keeps idle cost near nothing; expect a cold start on the first request, like Render.
4. **Cache.** Bundles are keyed by seed and LLM variant, so the first request after switching providers regenerates
   the match once and stores it.
5. **Cost.** Azure's free account credit is time-limited and the LLM is the main cost. `LLM_SEED_ALLOWLIST`,
   `LLM_MAX_CALLS_PER_MATCH` and the bundle cache exist to cap calls. Set a budget alert before enabling the LLM.
