/**
 * Phase 1 — fund the Foundry deployer EOA from the Phase 0 spike wallet.
 *
 * THROWAWAY, like spike.ts. Not part of the pnpm workspace. Reuses this
 * directory's node_modules (@privy-io/node, viem) and .env-loading pattern.
 *
 * Why this exists: the phase-0 wallet's policy (docs/evidence/phase0-policy.json)
 * permits USDC transfer() only to the spike's `permittedPayee`
 * (0x634186595D6E038094A8b0E25b38AA2f498D5407) — a throwaway address whose
 * private key was generated in-memory during the spike and never persisted.
 * Funds are policy-locked to an address nobody can spend from. That is
 * working as intended for a locked account, but it means the wallet cannot
 * fund a new deployer EOA without a real quorum-signed policy widen — the
 * same ceremony invariant 3 requires for any production widen, not a bypass.
 *
 * D:\BOLT\.env now holds the PRIVATE half of the key-quorum authorization
 * key (it held only the public half during the spike), so this widen is a
 * real quorum-signed request, not an admin override. It ADDS the new
 * deployer address alongside the existing permitted payee — additive, never
 * replaces or removes the phase-0 evidence's original condition.
 *
 * Docs worked from (privy-docs MCP): /controls/policies/update-a-policy.mdx
 *   — "Edit a rule in a policy" — client.policies().updateRule(ruleId, {...}, authorization_context)
 *   /controls/key-quorum/sign.mdx — quorum signing via authorization_context
 * Arc (arc-docs): /integrate/deploy-on-arc.mdx — cast wallet new / forge create pattern
 */
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PrivyClient} from '@privy-io/node';
import {createPublicClient, http, encodeFunctionData, numberToHex, getAddress, type Hex} from 'viem';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const CHAIN_ID = 5042002;
const CAIP2 = `eip155:${CHAIN_ID}` as const;
const RPC_URL = 'https://rpc.testnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';

const WALLET_ID = 'ule8cjaznx9y9khgs4ohtgqp';
const WALLET = '0x03929eB4825eCf791eFb17852B5e5C7A8556a871' as const;
const POLICY_ID = 'c5sp0lfcxusc1day0zpc15ah';
const SEND_RULE_ID = 'ulp9shba2c3o8udc3yvdqscs'; // eth_sendTransaction
const SIGN_RULE_ID = 'wyxl699cohi2m8ut7fqc7hxa'; // eth_signTransaction
const ORIGINAL_PERMITTED_PAYEE = '0x634186595D6E038094A8b0E25b38AA2f498D5407';

// Deployer EOA from `cast wallet new` (Phase 1 task 8).
const DEPLOYER_ADDRESS = process.argv[2];
const FUND_AMOUNT = 2_000_000n; // 2.00 USDC — ample for one contract deployment's gas

if (!DEPLOYER_ADDRESS) {
  throw new Error('usage: tsx fund-deployer.ts <deployer-address>');
}

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

function loadEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const jsonify = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

const env = loadEnv(join(REPO, '.env'));
const appId = env.NEXT_PUBLIC_PRIVY_APP_ID;
const appSecret = env.PRIVY_APP_SECRET;
const authKey = env.PRIVY_AUTHORIZATION_KEY;
if (!appId || !appSecret || !authKey) throw new Error('missing Privy credentials in D:\\BOLT\\.env');

const privy = new PrivyClient({appId, appSecret});
const authorization_context = {authorization_private_keys: [authKey]};
const publicClient = createPublicClient({transport: http(RPC_URL)});

const bothCasings = (a: string) => [a.toLowerCase(), getAddress(a)];
const widenedToValue = [...bothCasings(ORIGINAL_PERMITTED_PAYEE), ...bothCasings(DEPLOYER_ADDRESS)];

const widenedConditions = [
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
    value: widenedToValue
  }
];

console.log('1. widening policy', POLICY_ID, 'to also permit', DEPLOYER_ADDRESS, '(additive, quorum-signed)');

const sendRule = await privy.policies().updateRule(
  SEND_RULE_ID,
  {
    policy_id: POLICY_ID,
    name: 'USDC transfer to permitted payee (send)',
    method: 'eth_sendTransaction',
    action: 'ALLOW',
    conditions: widenedConditions
  } as never,
  authorization_context
);
console.log('   send rule updated:', (sendRule as {id: string}).id);

const signRule = await privy.policies().updateRule(
  SIGN_RULE_ID,
  {
    policy_id: POLICY_ID,
    name: 'USDC transfer to permitted payee (sign)',
    method: 'eth_signTransaction',
    action: 'ALLOW',
    conditions: widenedConditions
  } as never,
  authorization_context
);
console.log('   sign rule updated:', (signRule as {id: string}).id);

console.log('\n2. sending', FUND_AMOUNT, 'USDC base units from', WALLET, 'to', DEPLOYER_ADDRESS);

const [nonce, fees] = await Promise.all([
  publicClient.getTransactionCount({address: WALLET, blockTag: 'pending'}),
  publicClient.estimateFeesPerGas()
]);

const tx = {
  to: USDC,
  value: '0x0',
  data: encodeFunctionData({
    abi: BOLT_ERC20_ABI,
    functionName: 'transfer',
    args: [DEPLOYER_ADDRESS as `0x${string}`, FUND_AMOUNT]
  })
};

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

const hash = await publicClient.sendRawTransaction({serializedTransaction: signed.signed_transaction});
console.log('   tx hash:', hash);

const receipt = await publicClient.waitForTransactionReceipt({hash});
console.log('   status:', receipt.status, 'block:', receipt.blockNumber);

const balance = (await publicClient.readContract({
  address: USDC as `0x${string}`,
  abi: BOLT_ERC20_ABI,
  functionName: 'balanceOf',
  args: [DEPLOYER_ADDRESS as `0x${string}`]
})) as bigint;
console.log('   deployer USDC balance now:', balance.toString());

console.log(jsonify({policyWiden: {sendRule, signRule}, fundingTx: hash, receiptStatus: receipt.status, deployerBalance: balance.toString()}));
