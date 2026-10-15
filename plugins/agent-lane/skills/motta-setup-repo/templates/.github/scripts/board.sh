#!/usr/bin/env bash
# Delivery-board fields for one issue, by name (see .github/BOARD.md).
#
#   board.sh set <issue> <Field> <Option>   e.g. board.sh set 744 Status "In Review"
#   board.sh get <issue>                     prints Field=Value for every single-select field
#
# The item is found through the issue's own projectItems: the board holds more items than one
# GraphQL page, so scanning the board's first page misses issues. Option ids are looked up by
# name on every call because they change whenever an option is edited in the Projects UI.
set -euo pipefail

OWNER={{OWNER}}
REPO={{REPO}}
PROJECT={{PROJECT_NUMBER}}
PROJECT_ID={{PROJECT_ID}}

usage() {
  echo 'usage: board.sh set <issue> <Field> <Option> | board.sh get <issue>' >&2
  exit 2
}

item_id() {
  gh api graphql \
    -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){projectItems(first:20){nodes{id project{number}}}}}}' \
    -f o="$OWNER" -f r="$REPO" -F n="$1" \
    --jq ".data.repository.issue.projectItems.nodes[] | select(.project.number == $PROJECT) | .id"
}

cmd=${1:-}
issue=${2:-}
[[ "$issue" =~ ^[0-9]+$ ]] || usage

case "$cmd" in
  set)
    field=${3:-}
    option=${4:-}
    [ -n "$field" ] && [ -n "$option" ] || usage
    item=$(item_id "$issue")
    if [ -z "$item" ]; then
      item=$(gh project item-add "$PROJECT" --owner "$OWNER" \
        --url "https://github.com/$OWNER/$REPO/issues/$issue" --format json --jq .id)
    fi
    ids=$(gh api graphql \
      -f query='query($o:String!,$p:Int!){organization(login:$o){projectV2(number:$p){fields(first:30){nodes{... on ProjectV2SingleSelectField{id name options{id name}}}}}}}' \
      -f o="$OWNER" -F p="$PROJECT" \
      --jq ".data.organization.projectV2.fields.nodes[] | select(.name == \"$field\") | .id as \$f | .options[] | select(.name == \"$option\") | \"\(\$f) \(.id)\"")
    if [ -z "$ids" ]; then
      echo "board.sh: no option \"$option\" in field \"$field\"" >&2
      exit 1
    fi
    read -r field_id option_id <<<"$ids"
    gh api graphql \
      -f query='mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$v}}){projectV2Item{id}}}' \
      -f p="$PROJECT_ID" -f i="$item" -f f="$field_id" -f v="$option_id" --jq '.data | length' >/dev/null
    echo "#$issue $field = $option"
    ;;
  get)
    item=$(item_id "$issue")
    [ -n "$item" ] || { echo "#$issue is not on the board" >&2; exit 1; }
    gh api graphql \
      -f query='query($i:ID!){node(id:$i){... on ProjectV2Item{fieldValues(first:20){nodes{... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}}}}}}}' \
      -f i="$item" \
      --jq '.data.node.fieldValues.nodes[] | select(.field) | "\(.field.name)=\(.name)"'
    ;;
  *) usage ;;
esac
