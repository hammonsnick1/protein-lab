# Main branch protection

## Current blocker

On 2026-10-13, `gh api repos/hammonsnick1/protein-lab` reported
`permissions.admin: true`. Both the main branch protection endpoint and the
repository rulesets endpoint returned HTTP 403:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

Protection could not be configured under the current repository plan. No
billing or visibility changes were made. The repository owner must decide on
an eligible plan; keeping this private repository private avoids exposing its
contents. Until protection is available, these gates require manual enforcement.

## Owner setup after the plan supports protection

1. Open the repository's **Settings → Branches**, then add a branch protection
   rule for the exact pattern `main`.
2. Require pull requests and one approving review. Dismiss stale approvals
   when commits change. Leave pull-request bypass lists empty.
3. Require passing status checks and an up-to-date branch. Select all four
   checks from this repository's CI workflow:
   - `Frontend lint`
   - `Frontend typecheck`
   - `Frontend test`
   - `Backend pytest`
4. Apply the rule to administrators too by disabling bypass of these settings.
   Leave force pushes and deletions disabled, then save the rule.
5. Confirm the saved rule contains all four checks and requires pull requests.
   If check names are missing, run the foundations PR workflow first.

The Repo Steward reviews engineer PRs before merge. The foundations PR also
needs independent review because it was authored by the steward; the CEO
coordinates that review and merges only with owner sign-off.

Reference: [GitHub branch protection setup](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).
