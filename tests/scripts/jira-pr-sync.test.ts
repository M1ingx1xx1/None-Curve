// The Jira sync for pull requests (scripts/jira-pr-sync.ts), against a fake Jira that records every call: the keys a
// pull request names (branch, title, and the keys starting a "Jira:" line only), the step each event asks for, the
// account checked first, issues moved only forward and matched to their transition by the status it leads to, and how
// a run reports missing secrets, unknown issues, and refusals. Last, the script run as the workflow runs it. Nothing
// reaches the network.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FINISH, issueKeys, moveIssues, run, START, stepFor, type Fetch } from '../../scripts/jira-pr-sync'

const CATEGORY: Record<string, string> = { 'To Do': 'new', 'In Progress': 'indeterminate', 'In Review': 'indeterminate', Done: 'done' }
const TRANSITIONS = [
  { id: '11', name: 'To Do', to: { name: 'To Do' } },
  { id: '21', name: 'Start work', to: { name: 'In Progress' } },
  { id: '31', name: 'In Review', to: { name: 'In Review' } },
  { id: '41', name: 'Done', to: { name: 'Done' } },
]
const CONFIG = { baseUrl: 'https://example.atlassian.net/', email: 'me@example.com', token: 'secret-token' }
const ENV = { JIRA_BASE_URL: CONFIG.baseUrl, JIRA_EMAIL: CONFIG.email, JIRA_API_TOKEN: CONFIG.token, JIRA_PROJECT: 'NOCUR' }
const SIGN_IN = 'GET https://example.atlassian.net/rest/api/3/myself'

interface Call {
  method: string
  url: string
  body?: unknown
  authorization?: string
  redirect: string
}

type Stage = 'myself' | 'issue' | 'list' | 'move'

/** A Jira with these issues (key → status name). `refuse` answers the calls of a stage with that status instead;
    `signedOut` turns the account away as Jira Cloud does: 401 for the account, 404 for every issue. */
function fakeJira(
  issues: Record<string, string>,
  options: { refuse?: Partial<Record<Stage, number>>; signedOut?: boolean; transitions?: typeof TRANSITIONS } = {},
) {
  const calls: Call[] = []
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch: Fetch = async (url, init) => {
    const body = init.body && JSON.parse(init.body)
    calls.push({ method: init.method, url, body, authorization: init.headers.Authorization, redirect: init.redirect })
    const match = /\/rest\/api\/3\/(?:myself|issue\/([A-Z]+-\d+)(\/transitions)?)/.exec(url)
    const key = match?.[1] ?? ''
    const stage: Stage = !key ? 'myself' : !match?.[2] ? 'issue' : init.method === 'GET' ? 'list' : 'move'
    const refused = options.refuse?.[stage]
    if (refused) return reply(refused, { errorMessages: ['You do not have permission'] })
    if (options.signedOut) return stage === 'myself' ? reply(401) : reply(404, { errorMessages: ['Issue does not exist'] })
    if (stage === 'myself') return reply(200, { accountId: 'me' })
    if (!(key in issues)) return reply(404, { errorMessages: ['Issue does not exist'] })
    if (stage === 'issue') return reply(200, { fields: { status: { name: issues[key], statusCategory: { key: CATEGORY[issues[key]] } } } })
    if (stage === 'list') return reply(200, { transitions: options.transitions ?? TRANSITIONS })
    issues[key] = TRANSITIONS.find((t) => t.id === body.transition.id)!.to.name
    return reply(204)
  }
  return { fetch, calls, issues }
}

const event = (
  action: string,
  pr: { branch?: string; title?: string; body?: string | null; merged?: boolean; state?: string; fork?: boolean },
) => ({
  action,
  pull_request: {
    state: pr.state ?? (action === 'closed' ? 'closed' : 'open'),
    merged: pr.merged ?? false,
    title: pr.title ?? 'A change',
    body: pr.body ?? null,
    head: { ref: pr.branch ?? 'feature/thing', repo: { full_name: pr.fork ? 'someone/None-Curve' : 'M1ingx1xx1/None-Curve' } },
    base: { repo: { full_name: 'M1ingx1xx1/None-Curve' } },
  },
})

describe('issueKeys', () => {
  const keys = (pr: { branch?: string; title?: string; body?: string }) =>
    issueKeys({ branch: pr.branch ?? '', title: pr.title ?? '', body: pr.body ?? '' }, 'NOCUR')

  it('reads the branch name, in either case', () => {
    expect(keys({ branch: 'feature/NOCUR-57-jira-pr-sync' })).toEqual(['NOCUR-57'])
    expect(keys({ branch: 'feature/nocur-57-jira-pr-sync' })).toEqual(['NOCUR-57'])
  })

  it('reads the title and the keys starting "Jira:" lines, each key once, in order', () => {
    const body = [
      'Moves issues.',
      '',
      'Jira: NOCUR-12, nocur-3 and NOCUR-57.',
      '- **Jira:** [NOCUR-8](https://example.atlassian.net/browse/NOCUR-8)',
      '> jira : `NOCUR-9`',
    ].join('\r\n')
    expect(keys({ branch: 'feature/NOCUR-57-x', title: 'NOCUR-9: Sync', body })).toEqual(['NOCUR-57', 'NOCUR-9', 'NOCUR-12', 'NOCUR-3', 'NOCUR-8'])
  })

  it('stops a "Jira:" line at its first word that is not a key', () => {
    expect(keys({ body: 'Jira: NOCUR-60 (split from NOCUR-41)\nJira: see NOCUR-5' })).toEqual(['NOCUR-60'])
  })

  it('ignores keys mentioned elsewhere in the body, other projects, and look-alikes', () => {
    expect(keys({ body: 'Part of NOCUR-5 (see the Jira board).\nJiraz: NOCUR-6\nNot Jira: NOCUR-7' })).toEqual([])
    expect(keys({ title: 'ABC-1 UTF-8 XNOCUR-2 NOCUR-0 NOCUR-04 NOCUR- 3' })).toEqual([])
  })

  it('stops a key at its last digit', () => {
    expect(keys({ title: 'NOCUR-57a and NOCUR-58.' })).toEqual(['NOCUR-57', 'NOCUR-58'])
  })

  it('refuses a project key that is not one', () => {
    expect(() => issueKeys({ branch: '', title: '', body: '' }, 'NO.CUR')).toThrow(/project key/)
  })
})

describe('stepFor', () => {
  const open = { open: true, merged: false }

  it('starts work while a pull request is open, and finishes it when one merges', () => {
    for (const action of ['opened', 'reopened', 'synchronize', 'edited']) expect(stepFor(action, open)).toBe(START)
    expect(stepFor('closed', { open: false, merged: true })).toBe(FINISH)
  })

  it('moves nothing for a pull request closed without merging, for one edited after closing, or for other events', () => {
    expect(stepFor('closed', { open: false, merged: false })).toBeNull()
    expect(stepFor('edited', { open: false, merged: false })).toBeNull()
    for (const action of ['ready_for_review', 'labeled']) expect(stepFor(action, open)).toBeNull()
  })
})

describe('moveIssues', () => {
  it('checks the account, then moves an issue in To Do by the transition leading to In Progress', async () => {
    const jira = fakeJira({ 'NOCUR-1': 'To Do' })
    const [result] = await moveIssues(['NOCUR-1'], START, CONFIG, jira.fetch)
    expect(result).toEqual({ key: 'NOCUR-1', outcome: 'moved', status: 'To Do', message: 'NOCUR-1: To Do → In Progress' })
    expect(jira.issues['NOCUR-1']).toBe('In Progress')
    expect(jira.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      SIGN_IN,
      'GET https://example.atlassian.net/rest/api/3/issue/NOCUR-1?fields=status',
      'GET https://example.atlassian.net/rest/api/3/issue/NOCUR-1/transitions',
      'POST https://example.atlassian.net/rest/api/3/issue/NOCUR-1/transitions',
    ])
    expect(jira.calls[3].body).toEqual({ transition: { id: '21' } })
    const basic = `Basic ${Buffer.from('me@example.com:secret-token').toString('base64')}`
    expect(jira.calls.every((c) => c.authorization === basic && c.redirect === 'error')).toBe(true)
  })

  it('only moves forward: opening leaves In Progress, In Review, and Done alone', async () => {
    const jira = fakeJira({ 'NOCUR-1': 'In Progress', 'NOCUR-2': 'In Review', 'NOCUR-3': 'Done' })
    const results = await moveIssues(['NOCUR-1', 'NOCUR-2', 'NOCUR-3'], START, CONFIG, jira.fetch)
    expect(results.map((r) => r.outcome)).toEqual(['unchanged', 'unchanged', 'unchanged'])
    expect(jira.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('finishes every issue not yet done when a pull request merges', async () => {
    const jira = fakeJira({ 'NOCUR-1': 'To Do', 'NOCUR-2': 'In Progress', 'NOCUR-3': 'In Review', 'NOCUR-4': 'Done' })
    const results = await moveIssues(['NOCUR-1', 'NOCUR-2', 'NOCUR-3', 'NOCUR-4'], FINISH, CONFIG, jira.fetch)
    expect(results.map((r) => r.outcome)).toEqual(['moved', 'moved', 'moved', 'unchanged'])
    expect(Object.values(jira.issues)).toEqual(['Done', 'Done', 'Done', 'Done'])
  })

  it('reports an unknown issue and one with no way to the status, and goes on with the rest', async () => {
    const jira = fakeJira({ 'NOCUR-1': 'To Do' }, { transitions: TRANSITIONS.filter((t) => t.id !== '21') })
    const results = await moveIssues(['NOCUR-2', 'NOCUR-1'], START, CONFIG, jira.fetch)
    expect(results.map((r) => r.outcome)).toEqual(['missing', 'stuck'])
    expect(results[1].message).toBe('NOCUR-1: no transition from To Do to In Progress')
  })

  it('fails every issue when Jira does not accept the account, though it would answer 404 for each', async () => {
    const jira = fakeJira({ 'NOCUR-1': 'To Do' }, { signedOut: true })
    const results = await moveIssues(['NOCUR-1', 'NOCUR-2'], START, CONFIG, jira.fetch)
    expect(results).toEqual([
      { key: 'NOCUR-1', outcome: 'failed', message: 'NOCUR-1: Jira answered 401 signing in (check JIRA_EMAIL and JIRA_API_TOKEN)' },
      { key: 'NOCUR-2', outcome: 'failed', message: 'NOCUR-2: Jira answered 401 signing in (check JIRA_EMAIL and JIRA_API_TOKEN)' },
    ])
    expect(jira.calls.map((c) => `${c.method} ${c.url}`)).toEqual([SIGN_IN])
  })

  it('reports a refusal at each stage with what Jira said', async () => {
    const at = async (stage: Stage, status: number) =>
      (await moveIssues(['NOCUR-1'], START, CONFIG, fakeJira({ 'NOCUR-1': 'To Do' }, { refuse: { [stage]: status } }).fetch))[0]
    expect(await at('issue', 403)).toMatchObject({
      outcome: 'failed',
      message: 'NOCUR-1: Jira answered 403 reading the issue (check JIRA_EMAIL and JIRA_API_TOKEN): You do not have permission',
    })
    expect((await at('list', 500)).message).toBe('NOCUR-1: Jira answered 500 listing its transitions: You do not have permission')
    expect((await at('move', 400)).message).toBe('NOCUR-1: Jira answered 400 moving it to In Progress: You do not have permission')
  })

  it('fails an issue Jira lists no transitions for, naming the permission it may lack', async () => {
    const [result] = await moveIssues(['NOCUR-1'], START, CONFIG, fakeJira({ 'NOCUR-1': 'To Do' }, { transitions: [] }).fetch)
    expect(result).toMatchObject({ outcome: 'failed', message: expect.stringContaining('Transition issues permission') })
  })

  it('reports a network failure with its cause, without the site name and without throwing', async () => {
    const offline = await moveIssues(['NOCUR-1'], START, CONFIG, async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND example.atlassian.net') })
    })
    expect(offline).toEqual([{ key: 'NOCUR-1', outcome: 'failed', message: 'NOCUR-1: fetch failed (getaddrinfo ENOTFOUND <jira>)' }])
    const refused = await moveIssues(['NOCUR-1'], START, CONFIG, async () => {
      const cause = Object.assign(new AggregateError([new Error('connect ECONNREFUSED 10.0.0.1:443')], ''), { code: 'ECONNREFUSED' })
      throw new TypeError('fetch failed', { cause })
    })
    expect(refused[0].message).toBe('NOCUR-1: fetch failed (connect ECONNREFUSED 10.0.0.1:443)')
  })
})

describe('run', () => {
  it('moves the named issues when a pull request opens, with a notice and a summary', async () => {
    const jira = fakeJira({ 'NOCUR-57': 'To Do', 'NOCUR-5': 'In Progress' })
    const result = await run(event('opened', { branch: 'feature/NOCUR-57-jira', body: 'Part of NOCUR-5' }), ENV, jira.fetch)
    expect(result.exitCode).toBe(0)
    expect(result.lines).toEqual(['::notice::NOCUR-57: To Do → In Progress'])
    expect(result.summary).toContain('| NOCUR-57 | To Do | moved | To Do → In Progress |')
    expect(jira.issues).toEqual({ 'NOCUR-57': 'In Progress', 'NOCUR-5': 'In Progress' })
  })

  it('leaves the issue where it is on a later push, finishes it on merge, and moves nothing when closed unmerged', async () => {
    const jira = fakeJira({ 'NOCUR-57': 'In Progress' })
    const pushed = await run(event('synchronize', { branch: 'feature/NOCUR-57-jira' }), ENV, jira.fetch)
    expect(pushed).toMatchObject({ exitCode: 0, lines: ['NOCUR-57: left in In Progress'] })
    const calls = jira.calls.length
    const closed = await run(event('closed', { branch: 'feature/NOCUR-57-jira' }), ENV, jira.fetch)
    expect(closed).toEqual({ exitCode: 0, lines: ['Pull request closed (closed): nothing to move'], summary: '' })
    expect(jira.calls).toHaveLength(calls)
    const merged = await run(event('closed', { branch: 'feature/NOCUR-57-jira', merged: true }), ENV, jira.fetch)
    expect(merged.lines).toEqual(['::notice::NOCUR-57: In Progress → Done'])
    expect(jira.issues['NOCUR-57']).toBe('Done')
  })

  it('warns without failing when the secrets are not set, naming the ones missing, or saying a fork gets none', async () => {
    const jira = fakeJira({ 'NOCUR-57': 'To Do' })
    const partial = { JIRA_BASE_URL: CONFIG.baseUrl, JIRA_API_TOKEN: '' }
    expect(await run(event('opened', { title: 'NOCUR-57 Sync' }), partial, jira.fetch)).toEqual({
      exitCode: 0,
      lines: ['::warning::Not moving NOCUR-57: the repository secrets JIRA_EMAIL, JIRA_API_TOKEN are not set'],
      summary: '',
    })
    const fork = await run(event('opened', { title: 'NOCUR-57 Sync', fork: true }), {}, jira.fetch)
    expect(fork.lines).toEqual(['::warning::Not moving NOCUR-57: GitHub gives no secrets to a pull request from a fork, so move them by hand'])
    expect(jira.calls).toEqual([])
  })

  it('fails without calling Jira when JIRA_BASE_URL is not an https address', async () => {
    const jira = fakeJira({ 'NOCUR-57': 'To Do' })
    for (const url of ['http://example.atlassian.net', 'example.atlassian.net', 'https://']) {
      const result = await run(event('opened', { title: 'NOCUR-57' }), { ...ENV, JIRA_BASE_URL: url }, jira.fetch)
      expect(result.exitCode).toBe(1)
      expect(result.lines[0]).toMatch(/^::error::JIRA_BASE_URL must be the https address/)
    }
    expect(jira.calls).toEqual([])
  })

  it('says so when a pull request names no issue, and when the event is not a pull request', async () => {
    const jira = fakeJira({})
    const none = await run(event('opened', { body: 'Release develop to main.\nIncludes NOCUR-41.' }), ENV, jira.fetch)
    expect(none.lines).toEqual(['::notice::No NOCUR issue named in the branch, the title, or a "Jira:" line: nothing to move'])
    expect((await run({ action: 'opened' }, ENV, jira.fetch)).lines).toEqual(['::warning::Not a pull request event: nothing to move'])
    expect(jira.calls).toEqual([])
  })

  it('fails when Jira refuses, with every issue reported, and warns for an unknown one', async () => {
    const result = await run(event('opened', { title: 'NOCUR-1 and NOCUR-2' }), ENV, fakeJira({}, { signedOut: true }).fetch)
    expect(result.exitCode).toBe(1)
    expect(result.lines).toHaveLength(2)
    expect(result.lines.every((line) => line.startsWith('::error::NOCUR-'))).toBe(true)
    const unknown = await run(event('opened', { title: 'NOCUR-9' }), ENV, fakeJira({}).fetch)
    expect(unknown).toMatchObject({ exitCode: 0, lines: ['::warning::NOCUR-9: no such issue, or the account cannot see it'] })
  })

  it('keeps an annotation on one line and a summary cell in its column', async () => {
    const fetch = async () => {
      throw new Error('first line\nsecond | 100%')
    }
    const result = await run(event('opened', { title: 'NOCUR-1' }), ENV, fetch)
    expect(result.lines).toEqual(['::error::NOCUR-1: first line%0Asecond | 100%25'])
    expect(result.summary).toContain('| NOCUR-1 |  | failed | first line second \\| 100% |')
  })
})

describe('the script, run as the workflow runs it', () => {
  const runScript = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'jira-pr-sync-'))
    try {
      const path = join(dir, 'event.json')
      writeFileSync(path, JSON.stringify(event('opened', { branch: 'feature/NOCUR-57-jira' })))
      const child = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/jira-pr-sync.ts'], {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { PATH: process.env.PATH ?? '', GITHUB_EVENT_PATH: path, ...env },
        encoding: 'utf8',
        timeout: 30_000,
      })
      return { status: child.status, stdout: child.stdout.trim().split('\n') }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('warns and passes without the secrets', () => {
    expect(runScript({})).toEqual({
      status: 0,
      stdout: ['::warning::Not moving NOCUR-57: the repository secrets JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN are not set'],
    })
  })

  it('masks the site name and fails for a base URL that is not https', () => {
    const result = runScript({ JIRA_BASE_URL: 'http://example.atlassian.net', JIRA_EMAIL: 'me@example.com', JIRA_API_TOKEN: 'token' })
    expect(result.status).toBe(1)
    expect(result.stdout[0]).toBe('::add-mask::example.atlassian.net')
    expect(result.stdout[1]).toMatch(/^::error::JIRA_BASE_URL must be the https address/)
  })
})
