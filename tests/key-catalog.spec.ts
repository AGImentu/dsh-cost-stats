import { describe, expect, it } from 'vitest'
import { buildCatalog, refsFromConfig, refsFromCredentialStore } from '../src/host/key-catalog.ts'

/**
 * The shape DSH's local credential store actually has: a version, a list of
 * opaque records (session secrets, account tokens), then the flat `refs` block
 * that holds plain API keys.
 */
const STORE = `version: 1
records:
  - id: client-connection/browser-session
    kind: bearer
    payload:
      version: 1
      secret: not-a-key
  - id: deepseek-account-platform/default
    kind: oauth
    payload:
      version: 1
      token: not-a-key-either
refs:
  DEEPSEEK_API_KEY: sk-store-one
  MIXTOKEN_API_KEY: sk-store-two
`

describe('refsFromCredentialStore', () => {
  it('reads only the refs block, never the structural records', () => {
    expect(refsFromCredentialStore(STORE)).toEqual(['DEEPSEEK_API_KEY', 'MIXTOKEN_API_KEY'])
  })

  it('stops at the end of the block', () => {
    const text = `refs:
  A_KEY: one
other:
  B_KEY: two
`
    expect(refsFromCredentialStore(text)).toEqual(['A_KEY'])
  })

  it('accepts quoted names and ignores comments and blanks', () => {
    const text = `refs:
  # a comment
  "A_KEY": one

  'B_KEY': two
`
    expect(refsFromCredentialStore(text)).toEqual(['A_KEY', 'B_KEY'])
  })

  it('returns nothing for an empty or unreadable document', () => {
    expect(refsFromCredentialStore('')).toEqual([])
    expect(refsFromCredentialStore('version: 1\nrecords: []\n')).toEqual([])
  })

  it('falls back to a flat name → value map when there is no refs block', () => {
    expect(refsFromCredentialStore('version: 1\nA_KEY: one\nB_KEY: two\n')).toEqual(['A_KEY', 'B_KEY'])
  })

  it('never mistakes a value for a name', () => {
    const text = 'refs:\n  A_KEY: sk-1234567890\n'
    expect(refsFromCredentialStore(text)).toEqual(['A_KEY'])
    expect(refsFromCredentialStore(text).join()).not.toContain('sk-')
  })
})

describe('refsFromConfig', () => {
  const PATCH = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      mixtoken:
        displayName: https://api.mixtoken.ai/v1
        apiKeyEnv: MIXTOKEN_API_KEY
        api: openai-completions
      another:
        apiKeyEnv: "ANOTHER_KEY"
        api: openai-completions
`

  it('reads every declared apiKeyEnv with its provider id and display name', () => {
    expect(refsFromConfig(PATCH)).toEqual([
      // The label is what 「设置 → 模型」 shows for the provider — here a base URL,
      // because that is what this profile's displayName says.
      { ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken', label: 'https://api.mixtoken.ai/v1' },
      { ref: 'ANOTHER_KEY', provider: 'another' },
    ])
  })

  it('keeps a quoted display name, and takes the provider id when there is none', () => {
    const text = `providers:
  quoted:
    displayName: "My Relay"
    apiKeyEnv: QUOTED_KEY
  plain:
    apiKeyEnv: PLAIN_KEY
`
    expect(refsFromConfig(text)).toEqual([
      { ref: 'QUOTED_KEY', provider: 'quoted', label: 'My Relay' },
      { ref: 'PLAIN_KEY', provider: 'plain' },
    ])
  })

  it('does not borrow a displayName from the following block', () => {
    const text = `providers:
  first:
    apiKeyEnv: FIRST_KEY
  second:
    displayName: Second Relay
    apiKeyEnv: SECOND_KEY
`
    expect(refsFromConfig(text)).toEqual([
      { ref: 'FIRST_KEY', provider: 'first' },
      { ref: 'SECOND_KEY', provider: 'second', label: 'Second Relay' },
    ])
  })

  it('deduplicates a reference two providers share', () => {
    const text = `a:
  apiKeyEnv: SHARED_KEY
b:
  apiKeyEnv: SHARED_KEY
`
    expect(refsFromConfig(text)).toEqual([{ ref: 'SHARED_KEY', provider: 'a' }])
  })

  it('ignores anything that is not a reference name', () => {
    const text = `a:
  apiKeyEnv: \${SOME_EXPRESSION}
b:
  apiKeyEnv: "has-dash"
`
    expect(refsFromConfig(text)).toEqual([])
  })

  it('returns nothing for an empty document', () => {
    expect(refsFromConfig('')).toEqual([])
  })
})

describe('buildCatalog', () => {
  /** What the page renders, given the evidence. */
  function catalog(state: 'set' | 'unset' | 'unknown', envHas: (ref: string) => boolean = () => false) {
    return buildCatalog({
      defaultRef: 'DEEPSEEK_API_KEY',
      storeRefs: ['MIXTOKEN_API_KEY'],
      configRefs: [{ ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken' }, { ref: 'OTHER_KEY' }],
      envHas,
      state: () => state,
    })
  }

  it('puts the harness default first and keeps every source', () => {
    expect(catalog('set').map(row => row.ref)).toEqual(['DEEPSEEK_API_KEY', 'MIXTOKEN_API_KEY', 'OTHER_KEY'])
    expect(catalog('set')[0]).toMatchObject({ ref: 'DEEPSEEK_API_KEY', origin: 'default', configured: true })
    expect(catalog('set')[1]).toMatchObject({ ref: 'MIXTOKEN_API_KEY', origin: 'store', provider: 'mixtoken' })
    expect(catalog('set')[2]).toMatchObject({ ref: 'OTHER_KEY', origin: 'config', configured: true })
  })

  it('labels each entry the way the model settings page names it', () => {
    const rows = buildCatalog({
      defaultRef: 'DEEPSEEK_API_KEY',
      storeRefs: ['MIXTOKEN_API_KEY'],
      configRefs: [
        { ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken', label: 'https://api.mixtoken.ai/v1' },
        { ref: 'OTHER_KEY' },
      ],
      envHas: () => false,
      state: () => 'set',
    })
    // The harness default has no readable config file, so its shipped name is
    // the built-in one; a configured provider takes its own displayName; a
    // provider without one falls back to the reference itself in the page.
    expect(rows.map(row => row.label)).toEqual(['DeepSeek', 'https://api.mixtoken.ai/v1', undefined])
  })

  it('fills in a label discovered after the row was created', () => {
    const rows = buildCatalog({
      defaultRef: 'DEEPSEEK_API_KEY',
      storeRefs: ['MIXTOKEN_API_KEY'],
      configRefs: [{ ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken', label: 'Mixtoken' }],
      envHas: () => false,
      state: () => 'set',
    })
    // The store mentioned it first (no label); the config supplies both facts.
    expect(rows[1]).toMatchObject({ ref: 'MIXTOKEN_API_KEY', origin: 'store', provider: 'mixtoken', label: 'Mixtoken' })
  })

  it('collects every provider id a credential pays for, including the built-in one', () => {
    const rows = buildCatalog({
      defaultRef: 'DEEPSEEK_API_KEY',
      storeRefs: ['MIXTOKEN_API_KEY'],
      // Two providers sharing one reference: the filter needs both ids, or one
      // of them would silently disappear from the table.
      configRefs: [
        { ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken' },
        { ref: 'MIXTOKEN_API_KEY', provider: 'mixtoken-backup' },
      ],
      envHas: () => false,
      state: () => 'set',
    })
    expect(rows[0]).toMatchObject({
      ref: 'DEEPSEEK_API_KEY',
      label: 'DeepSeek',
      providers: ['deepseek-official'],
    })
    expect(rows[1]).toMatchObject({
      ref: 'MIXTOKEN_API_KEY',
      providers: ['mixtoken', 'mixtoken-backup'],
    })
  })

  it('reports a reference the service says is not configured', () => {
    expect(catalog('unset').map(row => row.configured)).toEqual([false, false, false])
  })

  it('falls back to textual evidence when the build cannot describe', () => {
    const rows = catalog('unknown', ref => ref === 'OTHER_KEY')
    expect(rows.map(row => [row.ref, row.configured])).toEqual([
      ['DEEPSEEK_API_KEY', false],
      ['MIXTOKEN_API_KEY', true],
      ['OTHER_KEY', true],
    ])
  })

  it('refuses a malformed reference instead of listing it', () => {
    const rows = buildCatalog({
      defaultRef: 'DEEPSEEK_API_KEY',
      storeRefs: ['not a ref'],
      configRefs: [],
      envHas: () => false,
      state: () => 'unknown',
    })
    expect(rows.map(row => row.ref)).toEqual(['DEEPSEEK_API_KEY'])
  })

  it('carries no value: the rows are names and flags only', () => {
    expect(JSON.stringify(catalog('set'))).not.toContain('sk-')
  })
})
