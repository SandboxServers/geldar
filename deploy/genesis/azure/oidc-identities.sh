#!/bin/sh
# Creates the Azure workload identity per environment (G2-04): an app and service principal, a federated credential
# bound to the GitHub Environment subject environment:<name>, and the role assignments of plan.md section 6.
# Run by the subscription owner with `az` logged in to the right tenant and subscription (az account set).
# Dry-run is the default: it prints what it would create and makes no az call. --apply lists before each create,
# so a second run creates nothing. No client secret is created: the federated credential replaces it.
#
# Roles (plan.md section 6): production gets DNS Zone Contributor on the DNS zone and Key Vault Secrets Officer on
# kv-geldar-production; test gets Key Vault Secrets Officer on kv-geldar-test only (record-set scoping is not
# implemented here); ephemeral gets no role until plan.md names one. The vaults must exist (the Azure bootstrap).
#
# Usage: sh deploy/genesis/azure/oidc-identities.sh --repo <owner/name> --repository-id <numeric id>
#          --resource-group <group> --dns-zone-id <zone resource id>
#          [--environments "production test ephemeral"] [--apply | --dry-run]
# Every name and id comes from arguments. This file holds no tenant id, subscription id, account name or secret.
set -eu

REPO=""
REPO_ID=""
RG=""
DNS_ZONE_ID=""
ENVIRONMENTS="production test ephemeral"
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --repository-id) REPO_ID=$2; shift 2 ;;
    --resource-group) RG=$2; shift 2 ;;
    --dns-zone-id) DNS_ZONE_ID=$2; shift 2 ;;
    --environments) ENVIRONMENTS=$2; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --dry-run) APPLY=0; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$REPO" in
  */*/*|/*|*/|'') echo "--repo must be owner/name" >&2; exit 2 ;;
  */*) ;;
  *) echo "--repo must be owner/name" >&2; exit 2 ;;
esac
case "$REPO_ID" in
  ''|*[!0-9]*) echo "--repository-id must be the numeric GitHub repository id" >&2; exit 2 ;;
esac
if [ -z "$RG" ] || [ -z "$DNS_ZONE_ID" ]; then
  echo "--resource-group and --dns-zone-id are required" >&2
  exit 2
fi

ISSUER="https://token.actions.githubusercontent.com"
AUDIENCE="api://AzureADTokenExchange"
DNS_ROLE="DNS Zone Contributor"
VAULT_ROLE="Key Vault Secrets Officer"

# ensure_role <role> <scope> <principal object id>: lists the assignment, creates it only when absent.
ensure_role() {
  existing=$(az role assignment list --assignee-object-id "$3" --role "$1" --scope "$2" --query "[0].id" -o tsv)
  if [ -n "$existing" ]; then
    echo "exists role $1 on $2"
    return 0
  fi
  az role assignment create --assignee-object-id "$3" --assignee-principal-type ServicePrincipal \
    --role "$1" --scope "$2" >/dev/null
  echo "created role $1 on $2"
}

for ENV in $ENVIRONMENTS; do
  case "$ENV" in
    ''|*[!a-z0-9-]*) echo "bad environment name: $ENV" >&2; exit 2 ;;
  esac
  APP="geldar-$ENV-deploy"
  FIC_NAME="geldar-$ENV-environment"
  SUBJECT="repo:$REPO:environment:$ENV"
  FIC_JSON="{\"name\":\"$FIC_NAME\",\"issuer\":\"$ISSUER\",\"subject\":\"$SUBJECT\",\"audiences\":[\"$AUDIENCE\"],\"description\":\"repository_id=$REPO_ID\"}"
  VAULT="kv-geldar-$ENV"
  WANT_DNS=0
  WANT_VAULT=0
  case "$ENV" in
    production) WANT_DNS=1; WANT_VAULT=1 ;;
    test) WANT_VAULT=1 ;;
  esac

  if [ "$APPLY" = 0 ]; then
    echo "dry-run: identity $APP: list by display name, create the app if none; list the service principal, create it if none"
    echo "dry-run: federated credential $FIC_NAME: list by name, create if none, body $FIC_JSON"
    [ "$WANT_DNS" = 1 ] && echo "dry-run: role $DNS_ROLE on $DNS_ZONE_ID (list, create if none)"
    [ "$WANT_VAULT" = 1 ] && echo "dry-run: role $VAULT_ROLE on vault $VAULT in $RG (list, create if none)"
    [ "$WANT_DNS" = 0 ] && [ "$WANT_VAULT" = 0 ] && echo "dry-run: no role assignment for $ENV"
    continue
  fi

  APP_ID=$(az ad app list --display-name "$APP" --query "[0].appId" -o tsv)
  if [ -z "$APP_ID" ]; then
    APP_ID=$(az ad app create --display-name "$APP" --query appId -o tsv)
    echo "created app $APP"
  else
    echo "exists app $APP"
  fi
  SP_ID=$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)
  if [ -z "$SP_ID" ]; then
    SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
    echo "created service principal for $APP"
  fi
  FIC=$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='$FIC_NAME'].name | [0]" -o tsv)
  if [ -z "$FIC" ]; then
    az ad app federated-credential create --id "$APP_ID" --parameters "$FIC_JSON" >/dev/null
    echo "created federated credential $FIC_NAME"
  else
    echo "exists federated credential $FIC_NAME"
  fi
  if [ "$WANT_DNS" = 1 ]; then ensure_role "$DNS_ROLE" "$DNS_ZONE_ID" "$SP_ID"; fi
  if [ "$WANT_VAULT" = 1 ]; then
    VAULT_ID=$(az keyvault show --name "$VAULT" --resource-group "$RG" --query id -o tsv)
    ensure_role "$VAULT_ROLE" "$VAULT_ID" "$SP_ID"
  fi
done

if [ "$APPLY" = 0 ]; then
  echo "dry-run: no az call made. Re-run with --apply to create what is missing."
fi
