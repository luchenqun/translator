import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as dotenv from 'dotenv';
import minimist from 'minimist';
import configureApiCaller, { ApiCaller, ApiOptions } from './api.js';
import {
  replaceCodeBlocks,
  restoreCodeBlocks,
  splitStringAtBlankLines
} from './md-utils.js';
import { Status, statusToText } from './status.js';

// Run this like:
// npx ts-node-esm index.ts <file_name>

const __dirname = path.dirname(new URL(import.meta.url).pathname);

dotenv.config();
export const apiKey = process.env.OPENAI_API_KEY;
const baseDir = process.env.GPT_TRANSLATOR_BASE_DIR ?? process.cwd();
const promptFile = path.resolve(
  __dirname,
  process.env.PROMPT_FILE ?? 'prompt.md'
);

const checkConfiguration = async () => {
  const errors = [];
  if (!apiKey) {
    errors.push('The OPENAI_API_KEY environment variable is not set.');
  }
  try {
    await fs.access(promptFile);
  } catch (e) {
    errors.push(`The prompt file "${promptFile}" does not exist.`);
  }
  if (errors.length) {
    console.error('Errors:');
    console.error(errors.join('\n'));
    process.exit(1);
  }
};

const translateMultiple = async (
  callApi: ApiCaller,
  fragments: string[],
  instruction: string,
  apiOptions: ApiOptions,
  onStatus: (status: Status) => void
) => {
  const statuses: Status[] = new Array(fragments.length).fill(0).map(() => ({
    status: 'waiting'
  }));
  onStatus({ status: 'pending', lastToken: '' });
  const handleNewStatus = (index: number) => {
    return (status: Status) => {
      statuses[index] = status;
      onStatus({
        status: 'pending',
        lastToken: `[${statuses.map(statusToText).join(', ')}]`
      });
    };
  };
  const results = await Promise.all(
    fragments.map((fragment, index) =>
      translateOne(
        callApi,
        fragment,
        instruction,
        apiOptions,
        handleNewStatus(index)
      )
    )
  );
  const finalResult = results.join('\n\n');
  onStatus({ status: 'done', translation: finalResult });
  return finalResult;
};

const translateOne = async (
  callApi: ApiCaller,
  text: string,
  instruction: string,
  apiOptions: ApiOptions,
  onStatus: (status: Status) => void
): Promise<string> => {
  onStatus({ status: 'waiting' });
  const res = await callApi(text, instruction, apiOptions, onStatus);

  if (
    res.status === 'error' &&
    res.message.match(/reduce the length|stream read error/i)
  ) {
    // Looks like the input was too long, so split the text in half and retry
    const splitResult = splitStringAtBlankLines(text, 0);
    console.log(
      'Split: ',
      splitResult?.map(s => s.length + ':' + s.slice(0, 20)).join(', ')
    );
    console.log('\n\n');
    if (splitResult === null) return text; // perhaps code blocks only
    return await translateMultiple(
      callApi,
      splitResult,
      instruction,
      apiOptions,
      onStatus
    );
  }

  if (res.status === 'error') throw new Error(res.message);
  return (res as { translation: string }).translation;
};

const resolveModelShorthand = (model: string): string => {
  const shorthands: { [key: string]: string } = {
    '4': 'gpt-4',
    '4large': 'gpt-4-32k',
    '3': 'gpt-3.5-turbo'
  };
  return shorthands[model] ?? model;
};
const sleep = async (time: number) => {
  return new Promise(resolve => setTimeout(resolve, time));
};

const readTextFile = async (filePath: string): Promise<string> => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    } else {
      throw e;
    }
  }
};

const getFiles = async (dir: string): Promise<string[]> => {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  let files = await Promise.all(
    dirents.map(dirent => {
      const res = `${dir}/${dirent.name}`;
      return dirent.isDirectory() ? getFiles(res) : res;
    })
  );
  return Array.prototype.concat(...files);
};

const main = async () => {
  await checkConfiguration();

  const args = minimist(process.argv.slice(2));
  const model = resolveModelShorthand(args.m ?? process.env.MODEL_NAME ?? '3');
  const temperature = Number(args.t) || Number(process.env.TEMPERATURE) || 0.1;
  const fragmentSize =
    Number(args.f) || Number(process.env.FRAGMENT_TOKEN_SIZE) || 2048;
  const apiCallInterval =
    Number(args.i) || Number(process.env.API_CALL_INTERVAL) || 0;
  const httpsProxy = process.env.HTTPS_PROXY;

  // let files = await getFiles(baseDir);
  // files = files.filter(item => item.endsWith('.md'));
  // console.log(JSON.stringify(files));
  const files = [
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/00-baseapp.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/01-transactions.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/02-context.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/03-node.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/04-store.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/05-interblock-cache.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/06-encoding.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/07-cli.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/08-events.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/09-grpc_rest.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/10-ocap.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/11-telemetry.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/12-runtx_middleware.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/13-simulation.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/14-proto-docs.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/15-tips.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/16-upgrade.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/advanced-concepts/17-config.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/glossary.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/high-level-concepts/00-overview-app.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/high-level-concepts/01-tx-lifecycle.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/high-level-concepts/02-query-lifecycle.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/high-level-concepts/03-accounts.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/high-level-concepts/04-gas-fees.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/intro/00-what-is-sdk.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/intro/01-why-app-specific.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/intro/02-sdk-app-architecture.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/develop/intro/03-sdk-design.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/PROCESS.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-002-docs-structure.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-003-dynamic-capability-store.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-004-split-denomination-keys.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-006-secret-store-replacement.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-007-specialization-groups.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-008-dCERT-group.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-009-evidence-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-010-modular-antehandler.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-011-generalize-genesis-accounts.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-012-state-accessors.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-013-metrics.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-014-proportional-slashing.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-016-validator-consensus-key-rotation.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-017-historical-header-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-018-extendable-voting-period.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-019-protobuf-state-encoding.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-020-protobuf-transaction-encoding.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-021-protobuf-query-encoding.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-022-custom-panic-handling.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-023-protobuf-naming.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-024-coin-metadata.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-027-deterministic-protobuf-serialization.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-028-public-key-addresses.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-029-fee-grant-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-030-authz-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-031-msg-service.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-032-typed-events.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-033-protobuf-inter-module-comm.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-034-account-rekeying.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-035-rosetta-api-support.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-036-arbitrary-signature.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-037-gov-split-vote.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-038-state-listening.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-039-epoched-staking.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-040-storage-and-smt-state-commitments.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-041-in-place-store-migrations.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-042-group-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-043-nft-module.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-044-protobuf-updates-guidelines.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-045-check-delivertx-middlewares.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-046-module-params.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-047-extend-upgrade-plan.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-048-consensus-fees.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-049-state-sync-hooks.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-050-sign-mode-textual-annex1.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-050-sign-mode-textual-annex2.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-050-sign-mode-textual.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-053-go-module-refactoring.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-054-semver-compatible-modules.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-055-orm.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-057-app-wiring.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-058-auto-generated-cli.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-059-test-scopes.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-060-abci-1.0.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-061-liquid-staking.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-062-collections-state-layer.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-063-core-module-api.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-064-abci-2.0.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-065-store-v2.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/architecture/adr-template.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-apps/00-app-go.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-apps/01-app-go-v2.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-apps/02-app-mempool.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-apps/03-app-upgrade.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/00-intro.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/01-module-manager.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/02-messages-and-queries.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/03-msg-services.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/04-query-services.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/05-beginblock-endblock.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/06-keeper.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/07-invariants.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/08-genesis.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/09-module-interfaces.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/11-structure.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/12-errors.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/13-upgrade.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/14-simulator.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/15-depinject.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/building-modules/16-testing.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/libraries/01-depinject.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/libraries/02-collections.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/libraries/03-orm.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/libraries/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/migrations/01-intro.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/migrations/02-upgrading.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/auth/1-vesting.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/auth/2-tx.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/auth/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/authz/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/bank/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/circuit/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/consensus/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/crisis/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/distribution/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/evidence/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/feegrant/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/genutil/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/gov/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/group/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/mint/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/nft/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/params/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/slashing/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/staking/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/modules/upgrade/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/rfc/PROCESS.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/rfc/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/rfc/rfc-001-tx-validation.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/rfc/rfc-template.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/SPEC_MODULE.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/SPEC_STANDARD.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/addresses/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/addresses/bech32.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/ics/README.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/spec/ics/ics-030-signed-messages.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/00-protobuf.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/01-cosmovisor.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/02-confix.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/03-autocli.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/04-hubl.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/integrate/tooling/05-depinject.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/00-keyring.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/01-run-node.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/02-interact-node.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/03-txs.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/04-rosetta.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/user/run-node/06-run-production.md',
    '/Users/lcq/Code/cosmos-sdk-docs/docs/validate/05-run-testnet.md'
  ];

  const donesStr = await fs.readFile('./dones.json', 'utf-8');
  let dones = JSON.parse(donesStr);

  for (const filePath of files) {
    if (dones.includes(filePath)) {
      continue;
    }
    const markdown = await readTextFile(filePath);
    const instruction = await readTextFile(promptFile);

    const { output: replacedMd, codeBlocks } = replaceCodeBlocks(markdown);
    const fragments = splitStringAtBlankLines(replacedMd, fragmentSize)!;

    let status: Status = { status: 'pending', lastToken: '' };

    console.log(`Translating ${filePath}...\n`);
    console.log(`Model: ${model}, Temperature: ${temperature}\n\n`);
    const printStatus = () => {
      process.stdout.write('\x1b[1A\x1b[2K'); // clear previous line
      console.log(statusToText(status));
    };
    printStatus();

    const callApi = configureApiCaller({
      apiKey: apiKey!,
      rateLimit: apiCallInterval,
      httpsProxy
    });

    const translatedText = await translateMultiple(
      callApi,
      fragments,
      instruction,
      { model, temperature },
      newStatus => {
        status = newStatus;
        printStatus();
      }
    );

    const finalResult =
      restoreCodeBlocks(translatedText, codeBlocks) + '\n\n\n';

    await fs.writeFile(filePath, finalResult, 'utf-8');
    await fs.appendFile(filePath, markdown, 'utf-8');
    console.log(`\nTranslation done! Saved to ${filePath}.`);
    dones.push(filePath);
    await fs.writeFile('./dones.json', JSON.stringify(dones), 'utf-8');
    // await sleep(10 * 60 * 1000);
  }
};

main().catch(console.error);
