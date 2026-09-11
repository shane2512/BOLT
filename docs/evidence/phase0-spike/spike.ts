/**
 * BOLT Phase 0 — live go/no-go spike. THROWAWAY. Not part of the pnpm workspace.
 *
 * Question: can a Privy policy decode Arc-testnet USDC transfer calldata and constrain
 * the decoded recipient, and does everything else get refused?
 *
 * Invariant 1: there is NO application-layer destination check anywhere in this file.
 * Every attack below is sent to Privy and the enclave is left to refuse it.
 *
 * Docs worked from (privy-docs MCP):
 *   /controls/policies/create-a-policy.mdx        — privy.policies().create({version,name,chain_type,rules,owner_id})
 *   /controls/policies/example-policies/ethereum.mdx — ethereum_calldata condition + inline abi
 *   /api-reference/intents/create-rule.mdx        — EthereumCalldataCondition requires `abi`; ethereum_transaction field enum = to|value|chain_id
 *   /wallets/wallets/create/create-a-wallet.mdx   — privy.wallets().create({chain_type,policy_ids}), one policy per wallet
 *   /controls/key-quorum/create.mdx               — privy.keyQuorums().create({public_keys,authorization_threshold})
 *   /wallets/using-wallets/ethereum/send-a-transaction.mdx — privy.wallets().ethereum().sendTransaction(id,{caip2,params})
 *   /wallets/using-wallets/ethereum/sign-a-transaction.mdx  — .signTransaction(id,{params:{transaction:{chain_id,...}}})
 *   /controls/authorization-keys/using-owners/sign/signing-on-the-server.mdx — authorization_context
 * Arc (arc-docs): /arc/references/connect-to-arc.mdx (chain 5042002, rpc), /arc/concepts/batched-transactions.mdx (Multicall3From)
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {createPrivateKey, createPublicKey} from 'node:crypto';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrivyClient} from '@privy-io/node';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  numberToHex,
  getAddress,
  type Hex
} from 'viem';
import {privateKeyToAccount, generatePrivateKey} from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const EVIDENCE = join(HERE, '..');
const STATE_FILE = join(HERE, 'state.json');

// ---------------------------------------------------------------- Arc testnet
const CHAIN_ID = 5042002;
const CAIP2 = `eip155:${CHAIN_ID}` as const;
const RPC_URL = 'https://rpc.testnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';
const MULTICALL3_FROM = '0x522fAf9A91c41c443c66765030741e4AaCe147D0';

// Money is bigint in USDC base units (6 decimals). Never a float.
const TRANSFER_AMOUNT = 10_000n; // 0.01 USDC

// ------------------------------------------------------------------ canonical
// The ABI the policy pins. Input named `_to` so the field path is `transfer._to`
// exactly as CLAUDE.md invariant 2 requires. NEVER viem's erc20Abi — that names
// the input `recipient` and silently changes the field path.
const BOLT_ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      {name: '_to', type: 'address'},
      {name: '_value', type: 'uint256'}
    ],
    outputs: [{name: '', type: 'bool'}]
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: '_spender', type: 'address'},
      {name: '_value', type: 'uint256'}
    ],
    outputs: [{name: '', type: 'bool'}]
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      {name: '_from', type: 'address'},
      {name: '_to', type: 'address'},
      {name: '_value', type: 'uint256'}
    ],
    outputs: [{name: '', type: 'bool'}]
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: '_owner', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}]
  }
] as const;

const MULTICALL_ABI = [
  {
    type: 'function',
    name: 'aggregate3',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          {name: 'target', type: 'address'},
          {name: 'allowFailure', type: 'bool'},
          {name: 'callData', type: 'bytes'}
        ]
      }
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          {name: 'success', type: 'bool'},
          {name: 'returnData', type: 'bytes'}
        ]
      }
    ]
  }
] as const;

// -------------------------------------------------------------------- helpers
function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

/**
 * PRIVY_AUTHORIZATION_KEY may hold either half of the P-256 keypair. Returns the
 * base64 DER (SPKI) public key, and whether we also hold the private half.
 * (In this .env it is the PUBLIC key — so no authorization signatures are possible.)
 */
function resolveAuthKey(b64: string): {publicKey: string; hasPrivate: boolean} {
  const der = Buffer.from(b64.replace(/^wallet-auth:/, ''), 'base64');
  try {
    const key = createPrivateKey({key: der, format: 'der', type: 'pkcs8'});
    return {
      publicKey: createPublicKey(key).export({format: 'der', type: 'spki'}).toString('base64'),
      hasPrivate: true
    };
  } catch {
    const key = createPublicKey({key: der, format: 'der', type: 'spki'});
    return {publicKey: key.export({format: 'der', type: 'spki'}).toString('base64'), hasPrivate: false};
  }
}

/** Preserve raw errors verbatim — every own property, no prettifying. */
function rawError(e: unknown): unknown {
  if (e === null || typeof e !== 'object') return {value: String(e)};
  const out: Record<string, unknown> = {__type: (e as object).constructor?.name ?? 'unknown'};
  for (const k of Object.getOwnPropertyNames(e)) out[k] = (e as Record<string, unknown>)[k];
  return out;
}

const jsonify = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

function writeEvidence(name: string, body: unknown): void {
  if (!existsSync(EVIDENCE)) mkdirSync(EVIDENCE, {recursive: true});
  const file = join(EVIDENCE, `${name}.json`);
  writeFileSync(file, jsonify(body) + '\n');
  console.log(`   -> docs/evidence/${name}.json`);
}

type State = {
  keyQuorumId?: string;
  policyId?: string;
  walletId?: string;
  walletAddress?: string;
  permittedPayee?: string;
  unpermittedPayee?: string;
};
const state: State = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State)
  : {};
const saveState = () => writeFileSync(STATE_FILE, jsonify(state) + '\n');

// ----------------------------------------------------------------------- main
const env = loadEnv(join(REPO, '.env'));
const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = env.PRIVY_APP_SECRET;
const authKey = env.PRIVY_AUTHORIZATION_KEY;
if (!appId || !appSecret || !authKey) throw new Error('missing Privy credentials in D:\\BOLT\\.env');

const privy = new PrivyClient({appId, appSecret});
const auth = resolveAuthKey(authKey);
console.log(
  auth.hasPrivate
    ? 'PRIVY_AUTHORIZATION_KEY: private half present — requests will be signed'
    : 'PRIVY_AUTHORIZATION_KEY: PUBLIC half only — cannot sign authorization requests'
);
// Only pass an authorization_context when we actually hold a private key.
const authorization_context = auth.hasPrivate ? {authorization_private_keys: [authKey]} : undefined;
const publicClient = createPublicClient({transport: http(RPC_URL)});

// 1. Key quorum — the policy owner. Without an owner the policy is widenable by
//    PRIVY_APP_SECRET alone, which is exactly the admin override invariant 3 forbids.
if (!state.keyQuorumId) {
  const kq = await privy.keyQuorums().create({
    public_keys: [auth.publicKey],
    authorization_threshold: 1,
    display_name: 'BOLT phase-0 spike quorum'
  });
  state.keyQuorumId = kq.id;
  saveState();
  writeEvidence('phase0-key-quorum', kq);
}
console.log('key quorum:', state.keyQuorumId);

// 2. Payees. The permitted one is baked into the policy; the other never is.
if (!state.permittedPayee) {
  state.permittedPayee = privateKeyToAccount(generatePrivateKey()).address;
  state.unpermittedPayee = privateKeyToAccount(generatePrivateKey()).address;
  saveState();
}
const PERMITTED = state.permittedPayee as `0x${string}`;
const UNPERMITTED = state.unpermittedPayee as `0x${string}`;
console.log('permitted payee  :', PERMITTED);
console.log('unpermitted payee:', UNPERMITTED);

// Docs: "All string comparisons are case-sensitive." We do not know which casing the
// enclave sees, so both spellings of the same address are listed. This is not a
// widening — it is the same address twice.
const bothCasings = (a: string) => [a.toLowerCase(), getAddress(a)];

// 3. The policy. Five conditions, ANDed. Default-deny is the engine's behaviour —
//    no trailing `DENY *` rule (it would take precedence and kill the ALLOW too).
//    No explicit DENY approve/transferFrom rules either: this spike must prove
//    default-deny empirically, not paper over it.
const allowConditions = [
  {field_source: 'ethereum_transaction', field: 'to', operator: 'in', value: bothCasings(USDC)},
  {
    field_source: 'ethereum_transaction',
    field: 'chain_id',
    operator: 'in',
    value: [String(CHAIN_ID), numberToHex(CHAIN_ID)]
  },
  {field_source: 'ethereum_transaction', field: 'value', operator: 'eq', value: '0'},
  {
    field_source: 'ethereum_calldata',
    field: 'function_name',
    abi: BOLT_ERC20_ABI,
    operator: 'eq',
    value: 'transfer'
  },
  {
    field_source: 'ethereum_calldata',
    field: 'transfer._to',
    abi: BOLT_ERC20_ABI,
    operator: 'in',
    value: bothCasings(PERMITTED)
  }
];

if (!state.policyId) {
  const policy = await privy.policies().create({
    version: '1.0',
    name: 'BOLT phase-0 locked account',
    chain_type: 'ethereum',
    owner_id: state.keyQuorumId,
    rules: [
      {
        name: 'USDC transfer to permitted payee (send)',
        method: 'eth_sendTransaction',
        action: 'ALLOW',
        conditions: allowConditions
      },
      {
        name: 'USDC transfer to permitted payee (sign)',
        method: 'eth_signTransaction',
        action: 'ALLOW',
        conditions: allowConditions
      }
    ]
  } as never);
  state.policyId = (policy as {id: string}).id;
  saveState();
  writeEvidence('phase0-policy', policy);
}
console.log('policy:', state.policyId);

// 4. Wallet, with the policy attached AT CREATION (FR-1.3: never briefly unlocked).
if (!state.walletId) {
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    policy_ids: [state.policyId!]
  });
  state.walletId = wallet.id;
  state.walletAddress = wallet.address;
  saveState();
  writeEvidence('phase0-wallet', wallet);
}
const WALLET_ID = state.walletId!;
const WALLET = state.walletAddress as `0x${string}`;
console.log('wallet:', WALLET, `(${WALLET_ID})`);

// 5. Funding gate. Simulation runs BEFORE policy evaluation on eth_sendTransaction,
//    so an unfunded wallet returns insufficient_funds, not policy_violation.
const balance = (await publicClient.readContract({
  address: USDC as `0x${string}`,
  abi: BOLT_ERC20_ABI,
  functionName: 'balanceOf',
  args: [WALLET]
})) as bigint;
console.log(`balance: ${balance} USDC base units`);

const funded = balance >= TRANSFER_AMOUNT;
if (!funded) {
  console.log(`\nNOT FUNDED (Circle faucet is reCAPTCHA-gated). Fund: ${WALLET}`);
  console.log('Falling back to the eth_signTransaction path, which runs NO pre-flight');
  console.log('simulation, so refusals arrive as clean policy_violation rather than');
  console.log('insufficient_funds. The enclave still evaluates the policy before it');
  console.log('reassembles the key, which is the thing Phase 0 has to prove.');
}

// ------------------------------------------------------------------- attacking
type Attempt = {
  name: string;
  expect: 'ALLOW' | 'REFUSE';
  tx: Record<string, unknown>;
};

const dirtyPad = (to: `0x${string}`): Hex =>
  // valid transfer(address,uint256) selector, but the address word's top 12 bytes
  // are garbage instead of zero-padding. A masking decoder still reads `to`.
  ('0xa9059cbb' +
    'deadbeefcafebabefeedface' +
    to.slice(2).toLowerCase() +
    TRANSFER_AMOUNT.toString(16).padStart(64, '0')) as Hex;

const trailingJunk = (to: `0x${string}`): Hex =>
  (encodeFunctionData({abi: BOLT_ERC20_ABI, functionName: 'transfer', args: [to, TRANSFER_AMOUNT]}) +
    'ffffffffffffffffffffffffffffffff') as Hex;

const attempts: Attempt[] = [
  {
    name: 'phase0-permitted-transfer',
    expect: 'ALLOW',
    tx: {
      to: USDC,
      value: '0x0',
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: 'transfer',
        args: [PERMITTED, TRANSFER_AMOUNT]
      })
    }
  },
  {
    name: 'phase0-refusal-wrong-destination',
    expect: 'REFUSE',
    tx: {
      to: USDC,
      value: '0x0',
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: 'transfer',
        args: [UNPERMITTED, TRANSFER_AMOUNT]
      })
    }
  },
  {
    // On Arc, USDC IS the native token: a bare value send moves real money and never
    // touches the USDC contract. Closed by the `transaction.to == USDC` condition.
    name: 'phase0-refusal-native-value-send',
    expect: 'REFUSE',
    tx: {to: UNPERMITTED, value: numberToHex(TRANSFER_AMOUNT), data: '0x'}
  },
  {
    // Permitted transfer calldata, but non-zero native value riding along.
    name: 'phase0-refusal-permitted-transfer-with-native-value',
    expect: 'REFUSE',
    tx: {
      to: USDC,
      value: numberToHex(TRANSFER_AMOUNT),
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: 'transfer',
        args: [PERMITTED, TRANSFER_AMOUNT]
      })
    }
  },
  {
    // Step 1 of the allowance drain. If this is ALLOWed, invariant 2 has a live gap.
    name: 'phase0-refusal-approve',
    expect: 'REFUSE',
    tx: {
      to: USDC,
      value: '0x0',
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: 'approve',
        args: [UNPERMITTED, 2n ** 256n - 1n]
      })
    }
  },
  {
    name: 'phase0-refusal-transferfrom',
    expect: 'REFUSE',
    tx: {
      to: USDC,
      value: '0x0',
      data: encodeFunctionData({
        abi: BOLT_ERC20_ABI,
        functionName: 'transferFrom',
        args: [WALLET, UNPERMITTED, TRANSFER_AMOUNT]
      })
    }
  },
  {
    name: 'phase0-refusal-dirty-padding-wrong-destination',
    expect: 'REFUSE',
    tx: {to: USDC, value: '0x0', data: dirtyPad(UNPERMITTED)}
  },
  {
    name: 'phase0-dirty-padding-permitted-destination',
    expect: 'ALLOW',
    tx: {to: USDC, value: '0x0', data: dirtyPad(PERMITTED)}
  },
  {
    name: 'phase0-refusal-trailing-bytes-wrong-destination',
    expect: 'REFUSE',
    tx: {to: USDC, value: '0x0', data: trailingJunk(UNPERMITTED)}
  },
  {
    name: 'phase0-refusal-multicall-wrapper',
    expect: 'REFUSE',
    tx: {
      to: MULTICALL3_FROM,
      value: '0x0',
      data: encodeFunctionData({
        abi: MULTICALL_ABI,
        functionName: 'aggregate3',
        args: [
          [
            {
              target: USDC as `0x${string}`,
              allowFailure: false,
              callData: encodeFunctionData({
                abi: BOLT_ERC20_ABI,
                functionName: 'transfer',
                args: [UNPERMITTED, TRANSFER_AMOUNT]
              })
            }
          ]
        ]
      })
    }
  }
];

/** Probe: does Privy broadcast on Arc natively, or must we sign and self-broadcast? */
let broadcastMode: 'privy' | 'self' = 'privy';

async function send(tx: Record<string, unknown>): Promise<unknown> {
  if (broadcastMode === 'privy') {
    return await privy.wallets().ethereum().sendTransaction(WALLET_ID, {
      caip2: CAIP2,
      params: {transaction: {from: WALLET, chain_id: CHAIN_ID, ...tx}},
      authorization_context
    } as never);
  }
  const [nonce, fees] = await Promise.all([
    publicClient.getTransactionCount({address: WALLET, blockTag: 'pending'}),
    publicClient.estimateFeesPerGas()
  ]);
  const signed = (await privy.wallets().ethereum().signTransaction(WALLET_ID, {
    params: {
      transaction: {
        from: WALLET,
        chain_id: CHAIN_ID,
        nonce,
        type: 2,
        gas_limit: 300_000,
        max_fee_per_gas: numberToHex(fees.maxFeePerGas),
        max_priority_fee_per_gas: numberToHex(fees.maxPriorityFeePerGas ?? 0n),
        ...tx
      }
    },
    authorization_context
  } as never)) as {signed_transaction: Hex};
  if (!funded) {
    return {
      signed_transaction: signed.signed_transaction,
      broadcast:
        'SKIPPED - wallet unfunded. The enclave ALLOWED this request and produced a signature.'
    };
  }
  const hash = await publicClient.sendRawTransaction({
    serializedTransaction: signed.signed_transaction
  });
  return {signed_transaction: signed.signed_transaction, hash, broadcast: 'self via viem'};
}

// Probe with the permitted transfer through the Privy broadcast path first.
console.log('\nprobing Privy native broadcast on', CAIP2, '...');
try {
  const probe = await send(attempts[0].tx);
  writeEvidence('phase0-arc-broadcast-probe', {mode: 'privy caip2', outcome: 'OK', response: probe});
  console.log('   Privy broadcast on Arc: SUPPORTED');
} catch (e) {
  const raw = rawError(e);
  const body = jsonify(raw).toLowerCase();
  const isPolicy = body.includes('policy_violation');
  writeEvidence('phase0-arc-broadcast-probe', {
    mode: 'privy caip2',
    outcome: isPolicy ? 'POLICY_VIOLATION (chain supported)' : 'FAILED',
    error: raw
  });
  if (!isPolicy) {
    broadcastMode = 'self';
    console.log('   Privy broadcast on Arc: NOT SUPPORTED -> eth_signTransaction + self-broadcast');
  }
}

if (!funded && broadcastMode === 'privy') {
  broadcastMode = 'self';
  console.log('   forcing sign path for the attack suite: unfunded + simulation-before-policy');
}
console.log(`\nbroadcast mode: ${broadcastMode}\n`);

const summary: {name: string; expect: string; got: string}[] = [];

for (const a of attempts) {
  process.stdout.write(`${a.name} (expect ${a.expect}) ... `);
  try {
    // NO application-layer destination check here. Send it; let the enclave refuse.
    const res = await send(a.tx);
    console.log('ALLOWED');
    summary.push({name: a.name, expect: a.expect, got: 'ALLOWED'});
    writeEvidence(a.name, {
      expect: a.expect,
      outcome: 'ALLOWED',
      broadcast_mode: broadcastMode,
      request: {wallet: WALLET, caip2: CAIP2, transaction: a.tx},
      response: res
    });
  } catch (e) {
    const raw = rawError(e);
    const refused = jsonify(raw).toLowerCase().includes('policy_violation');
    console.log(refused ? 'REFUSED (policy_violation)' : 'ERROR (not a policy violation)');
    summary.push({
      name: a.name,
      expect: a.expect,
      got: refused ? 'REFUSED (policy_violation)' : 'ERROR'
    });
    writeEvidence(a.name, {
      expect: a.expect,
      outcome: refused ? 'REFUSED' : 'ERROR',
      broadcast_mode: broadcastMode,
      request: {wallet: WALLET, caip2: CAIP2, transaction: a.tx},
      error: raw
    });
  }
}

writeEvidence('phase0-summary', {
  chain: {chain_id: CHAIN_ID, caip2: CAIP2, rpc: RPC_URL, usdc: USDC},
  wallet: WALLET,
  policy_id: state.policyId,
  key_quorum_id: state.keyQuorumId,
  permitted_payee: PERMITTED,
  unpermitted_payee: UNPERMITTED,
  broadcast_mode: broadcastMode,
  results: summary
});
console.log('\n', summary.map((s) => `${s.expect === 'ALLOW' ? '+' : '-'} ${s.name}: ${s.got}`).join('\n '));
