// Moves the Jira issues a pull request names along with it (.github/workflows/jira.yml): while the pull request is open
// (when it opens, reopens, gets a push, or is edited), an issue still in To Do goes to In Progress; when it merges, an
// issue not yet done goes to Done. Issues only move forward, so a pull request never pulls an issue back from In Review
// or Done, and one closed without merging moves nothing.
// A pull request names an issue by its key (NOCUR-57) in its branch name, its title, or the list of keys that starts a
// "Jira:" line of its body; keys anywhere else in the body (a parent mentioned in passing) do not count.
// Run by the workflow: node --experimental-strip-types scripts/jira-pr-sync.ts. It reads the event GitHub saved at
// GITHUB_EVENT_PATH, the repository secrets JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN, and JIRA_PROJECT (the
// project key). Without the secrets it warns and moves nothing, so the check does not fail for want of them; when Jira
// does not accept them, refuses a call, or cannot be reached, it fails.
// Node runs this file with its types stripped: no enums, namespaces, parameter properties or local imports.

import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export interface PullRequestText {
  branch: string
  title: string
  body: string
}

/** Where a pull request event moves its issues: to the status `to`, from a status in one of the categories `from`. */
export interface Step {
  to: string
  /** Jira's status categories: new (To Do), indeterminate (In Progress, In Review), done. */
  from: readonly string[]
}

export const START: Step = { to: 'In Progress', from: ['new'] }
export const FINISH: Step = { to: 'Done', from: ['new', 'indeterminate'] }

export interface JiraConfig {
  baseUrl: string
  email: string
  token: string
}

export interface IssueResult {
  key: string
  /** moved: now in the step's status. unchanged: not in a category the step moves from. missing: Jira has no such
      issue the account can see. stuck: no transition leads to the step's status. failed: Jira did not accept the
      account, refused a call, or did not answer. */
  outcome: 'moved' | 'unchanged' | 'missing' | 'stuck' | 'failed'
  /** The issue's status before, when Jira gave it. */
  status?: string
  message: string
}

export interface RunResult {
  exitCode: number
  /** Workflow commands and log lines, in order. */
  lines: string[]
  /** Markdown for the job summary, or '' when there is nothing to report. */
  summary: string
}

interface JiraResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; redirect: 'error'; signal: AbortSignal },
) => Promise<JiraResponse>

const TIMEOUT_MS = 15_000
const CREDENTIALS_HINT = ' (check JIRA_EMAIL and JIRA_API_TOKEN)'

/** The step a pull request event asks for, or null when it moves nothing. */
export function stepFor(action: string, pr: { open: boolean; merged: boolean }): Step | null {
  if (action === 'closed') return pr.merged ? FINISH : null
  // A push or an edit counts as well: GitHub runs nothing for a pull request opened while it conflicts with its base,
  // and a key may be added to the title or body later. Moving only forward makes the repeats harmless.
  if (pr.open && ['opened', 'reopened', 'synchronize', 'edited'].includes(action)) return START
  return null
}

/** The keys of `project`'s issues a pull request names, upper case, each once, in the order they first appear. */
export function issueKeys(pr: PullRequestText, project: string): string[] {
  if (!/^[A-Z][A-Z0-9_]*$/.test(project)) throw new Error(`Not a Jira project key: ${project}`)
  // Case-insensitive, for branch names in lower case; not inside a longer word, and never a number starting with 0.
  const key = new RegExp(`(?<![A-Za-z0-9])${project}-[1-9][0-9]*(?![0-9])`, 'gi')
  const whole = new RegExp(`^${project}-[1-9][0-9]*$`, 'i')
  const keys = [pr.branch, pr.title].flatMap((text) => text.match(key) ?? [])
  // "Jira: NOCUR-1, NOCUR-2", also as a list item, in bold, or as links ("- **Jira:** [NOCUR-1](https://…)"): the keys
  // that start the line, up to its first other word, so "Jira: NOCUR-60 (split from NOCUR-41)" names NOCUR-60 only.
  for (const line of pr.body.split(/\r?\n/)) {
    const label = /^[\s>*_-]*jira[\s*_]*:/i.exec(line)
    if (!label) continue
    for (const word of line.slice(label[0].length).split(/[\s,;]+/)) {
      if (/^([*_]*|and|&)$/i.test(word)) continue
      const bare = word.replace(/\]\(.*$/, '').replace(/^[[`*_]+|[\]`*_.:]+$/g, '')
      if (!whole.test(bare)) break
      keys.push(bare)
    }
  }
  return [...new Set(keys.map((k) => k.toUpperCase()))]
}

/** Moves each issue by `step` where its status allows, one after another; never throws. */
export async function moveIssues(
  keys: readonly string[],
  step: Step,
  config: JiraConfig,
  fetchImpl: Fetch,
): Promise<IssueResult[]> {
  const base = config.baseUrl.replace(/\/+$/, '')
  // The site's name stays out of messages: they reach the public log and the job summary.
  const host = hostOf(base)
  const scrub = (text: string) => (host ? text.split(host).join('<jira>') : text)
  const headers = {
    Authorization: `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  // No redirects: a wrong scheme or a moved site would drop the credentials on the way, and replay a POST as a GET.
  const call = (path: string, method = 'GET', body?: unknown) =>
    fetchImpl(`${base}/rest/api/3${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

  // Jira Cloud treats credentials it does not accept (a token expired or revoked, a wrong email) as nobody signed in,
  // and then answers 404 for every issue of a private project, as if none existed. Only this call says 401.
  let signInFailure = ''
  try {
    const me = await call('/myself')
    if (!me.ok) signInFailure = await refusal(me, 'signing in')
  } catch (error) {
    signInFailure = reason(error)
  }
  if (signInFailure) return keys.map((key) => ({ key, outcome: 'failed', message: `${key}: ${scrub(signInFailure)}` }))

  const results: IssueResult[] = []
  for (const key of keys) {
    try {
      const issue = await call(`/issue/${key}?fields=status`)
      if (issue.status === 404) {
        results.push({ key, outcome: 'missing', message: `${key}: no such issue, or the account cannot see it` })
        continue
      }
      if (!issue.ok) throw new Error(await refusal(issue, 'reading the issue'))
      const status = (await issue.json()) as {
        fields?: { status?: { name?: string; statusCategory?: { key?: string } } }
      }
      const name = status.fields?.status?.name ?? '?'
      const category = status.fields?.status?.statusCategory?.key ?? ''
      if (!step.from.includes(category)) {
        results.push({ key, outcome: 'unchanged', status: name, message: `${key}: left in ${name}` })
        continue
      }
      const listed = await call(`/issue/${key}/transitions`)
      if (!listed.ok) throw new Error(await refusal(listed, 'listing its transitions'))
      const { transitions = [] } = (await listed.json()) as {
        transitions?: { id: string; isAvailable?: boolean; to?: { name?: string } }[]
      }
      // Jira lists none at all for an account without the Transition issues permission.
      if (transitions.length === 0)
        throw new Error('Jira lists no transitions for it: the account may lack the Transition issues permission')
      // Matched by the status it leads to, not by its own name, which may differ.
      const target = step.to.toLowerCase()
      const transition = transitions.find((t) => t.isAvailable !== false && t.to?.name?.toLowerCase() === target)
      if (!transition) {
        results.push({
          key,
          outcome: 'stuck',
          status: name,
          message: `${key}: no transition from ${name} to ${step.to}`,
        })
        continue
      }
      const moved = await call(`/issue/${key}/transitions`, 'POST', { transition: { id: transition.id } })
      if (!moved.ok) throw new Error(await refusal(moved, `moving it to ${step.to}`))
      results.push({ key, outcome: 'moved', status: name, message: `${key}: ${name} → ${step.to}` })
    } catch (error) {
      results.push({ key, outcome: 'failed', message: `${key}: ${scrub(reason(error))}` })
    }
  }
  return results
}

/** The host of a URL, or '' when it is not one. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** An error's message, with its cause's when it has one: fetch says only "fetch failed" and keeps the rest there, in a
    cause whose own message may be empty (an AggregateError of every address tried). */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause as { message?: string; code?: string; errors?: { message?: string }[] } | undefined
  const detail = cause?.message || cause?.errors?.find((e) => e?.message)?.message || cause?.code || ''
  return detail && detail !== error.message ? `${error.message} (${detail})` : error.message
}

/** What Jira said when it refused a call: the status and its error messages, on one line. */
async function refusal(response: JiraResponse, doing: string): Promise<string> {
  let detail = ''
  try {
    const body = JSON.parse(await response.text()) as { errorMessages?: string[]; errors?: Record<string, string> }
    detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join('; ')
  } catch {
    // Not JSON: the status says enough.
  }
  const hint = response.status === 401 || response.status === 403 ? CREDENTIALS_HINT : ''
  return `Jira answered ${response.status} ${doing}${hint}${detail ? `: ${detail}` : ''}`.slice(0, 500)
}

/** Handles one pull request event: which issues to move, and how each went. Fails only when Jira did not accept the
    account, refused a call, or did not answer, or when JIRA_BASE_URL is not an https address. */
export async function run(
  event: unknown,
  env: Record<string, string | undefined>,
  fetchImpl: Fetch,
): Promise<RunResult> {
  const lines: string[] = []
  const done = (exitCode: number, summary = ''): RunResult => ({ exitCode, lines, summary })
  const payload = event as {
    action?: string
    pull_request?: {
      state?: string
      merged?: boolean
      title?: string | null
      body?: string | null
      head?: { ref?: string; repo?: { full_name?: string } | null }
      base?: { repo?: { full_name?: string } }
    }
  }
  const pr = payload.pull_request
  if (!pr) {
    lines.push(command('warning', 'Not a pull request event: nothing to move'))
    return done(0)
  }
  const action = payload.action ?? '?'
  const step = stepFor(action, { open: pr.state === 'open', merged: pr.merged === true })
  if (!step) {
    lines.push(`Pull request ${action} (${pr.merged ? 'merged' : (pr.state ?? '?')}): nothing to move`)
    return done(0)
  }
  const project = env.JIRA_PROJECT || 'NOCUR'
  const keys = issueKeys({ branch: pr.head?.ref ?? '', title: pr.title ?? '', body: pr.body ?? '' }, project)
  if (keys.length === 0) {
    lines.push(
      command('notice', `No ${project} issue named in the branch, the title, or a "Jira:" line: nothing to move`),
    )
    return done(0)
  }
  const { JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = env
  if (!baseUrl || !email || !token) {
    // GitHub gives no secrets to a pull request from a fork (head.repo is null once the fork is deleted).
    const fromFork = pr.head?.repo?.full_name !== pr.base?.repo?.full_name
    const absent = Object.entries({ JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_API_TOKEN: token })
      .filter(([, value]) => !value)
      .map(([name]) => name)
    const why = fromFork
      ? 'GitHub gives no secrets to a pull request from a fork, so move them by hand'
      : `the repository secrets ${absent.join(', ')} are not set`
    lines.push(command('warning', `Not moving ${keys.join(', ')}: ${why}`))
    return done(0)
  }
  if (!/^https:\/\/[^/]/i.test(baseUrl) || !hostOf(baseUrl)) {
    lines.push(
      command(
        'error',
        'JIRA_BASE_URL must be the https address of the Jira site, such as https://<site>.atlassian.net',
      ),
    )
    return done(1)
  }
  const results = await moveIssues(keys, step, { baseUrl, email, token }, fetchImpl)
  const level = { moved: 'notice', unchanged: null, missing: 'warning', stuck: 'warning', failed: 'error' } as const
  for (const result of results) {
    const kind = level[result.outcome]
    lines.push(kind ? command(kind, result.message) : result.message)
  }
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ')
  const rows = results.map(
    (r) => `| ${r.key} | ${cell(r.status ?? '')} | ${r.outcome} | ${cell(r.message.slice(r.key.length + 2))} |`,
  )
  const summary = [
    `### Jira: ${step.to}`,
    '',
    '| Issue | Before | Outcome | Detail |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
  return done(results.some((r) => r.outcome === 'failed') ? 1 : 0, summary)
}

/** A workflow command (an annotation) on one line, its message escaped as GitHub asks. */
function command(kind: 'notice' | 'warning' | 'error', message: string): string {
  return `::${kind}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`
}

async function main(): Promise<number> {
  const path = process.env.GITHUB_EVENT_PATH
  if (!path) {
    console.log(command('error', 'GITHUB_EVENT_PATH is not set: run this from the workflow'))
    return 1
  }
  // GitHub masks the secret's whole value only; the bare host can appear in other text.
  const host = hostOf(process.env.JIRA_BASE_URL ?? '')
  if (host) console.log(`::add-mask::${host}`)
  const result = await run(JSON.parse(readFileSync(path, 'utf8')), process.env, fetch)
  for (const line of result.lines) console.log(line)
  if (result.summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary)
  return result.exitCode
}

/** The real path of the file Node was asked to run (import.meta.url has its links resolved), or '' when there is none. */
function entryPath(): string {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : ''
  } catch {
    return ''
  }
}

const entry = entryPath()
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      console.log(command('error', reason(error)))
      process.exitCode = 1
    },
  )
}
