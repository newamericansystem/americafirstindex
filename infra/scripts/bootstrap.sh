#!/usr/bin/env bash
# One-time setup per environment. Run as a subscription Owner (or User Access Administrator + Contributor),
# with `gh` signed in.
# Usage: LOCATION=westus2 ./infra/scripts/bootstrap.sh dev|prod
set -euo pipefail
ENV="${1:?usage: bootstrap.sh dev|prod}"
LOCATION="${LOCATION:?set LOCATION}"
REPO="newamericansystem/americafirstindex"
RG="rg-afi-${ENV}"
ID_NAME="id-afi-github-${ENV}"

# The deploy identity is scoped to its resource group and cannot register providers itself.
for ns in Microsoft.AlertsManagement Microsoft.Communication Microsoft.DBforPostgreSQL Microsoft.Insights \
  Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Maps Microsoft.OperationalInsights \
  Microsoft.Storage Microsoft.Web; do
  az provider register -n "$ns" --wait -o none
done

az group create -n "$RG" -l "$LOCATION" --tags app=americafirstindex env="$ENV" -o none
az identity create -g "$RG" -n "$ID_NAME" -o none
PRINCIPAL_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query principalId -o tsv)
CLIENT_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query clientId -o tsv)
RG_ID=$(az group show -n "$RG" --query id -o tsv)

# A just-created identity can take a minute to replicate in Entra, so role assignments are retried.
assign_role() {
  for attempt in 1 2 3 4 5 6; do
    az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
      --role "$1" --scope "$RG_ID" -o none && return 0
    echo "role assignment '$1' failed (attempt $attempt); retrying in 20s" >&2
    sleep 20
  done
  return 1
}
assign_role "Contributor"
assign_role "Role Based Access Control Administrator"

# GitHub issues OIDC subjects keyed by immutable owner/repo IDs: repo:{owner}@{ownerId}/{repo}@{repoId}:...
SUBJECT_REPO=$(gh api "repos/${REPO}" -q '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"')
az identity federated-credential create -g "$RG" --identity-name "$ID_NAME" \
  --name "github-${ENV}" --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${SUBJECT_REPO}:environment:${ENV}" --audiences "api://AzureADTokenExchange" -o none

echo "AZURE_CLIENT_ID=${CLIENT_ID}"
