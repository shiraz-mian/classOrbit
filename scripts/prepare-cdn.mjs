import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CloudFormationClient, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation';
import { awsContext } from './lib/aws-context.mjs';
import { config } from '../server/src/config/index.js';
const args = process.argv.slice(2);
const allowed = new Set(['--credentials-env', '--region']);
for (let i = 0; i < args.length; i += 2)
  if (!allowed.has(args[i]) || !args[i + 1])
    throw new Error('Use --credentials-env <file> and/or --region <region>.');
const directory = path.join(config.root, '.data/cloudfront');
await mkdir(directory, { recursive: true });
const privatePath = path.join(directory, 'private.pem'),
  publicPath = path.join(directory, 'public.pem');
if (
  !(await access(privatePath).then(
    () => true,
    () => false,
  ))
) {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await writeFile(privatePath, pair.privateKey, { flag: 'wx', mode: 0o600 });
  await writeFile(publicPath, pair.publicKey, { flag: 'wx' });
}
const privateKey = createPrivateKey(await readFile(privatePath, 'utf8'));
if (
  privateKey.asymmetricKeyType !== 'rsa' ||
  privateKey.asymmetricKeyDetails?.modulusLength !== 2048
)
  throw new Error('Signing key must be RSA-2048.');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
if (
  await access(publicPath).then(
    () => true,
    () => false,
  )
) {
  if (
    createPublicKey(await readFile(publicPath, 'utf8')).export({ type: 'spki', format: 'pem' }) !==
    publicKey
  )
    throw new Error('Public and private signing keys do not match.');
} else await writeFile(publicPath, publicKey, { flag: 'wx' });
const origin = new URL(config.appUrl);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.appUrl)
  throw new Error('APP_URL must be an HTTP(S) origin without a trailing slash, path, or query.');
const template = await readFile(path.join(config.root, 'infra/aws/media-stack.json'), 'utf8');
const context = await awsContext(args);
const identity = await new STSClient(context).send(new GetCallerIdentityCommand({}));
console.log('AWS account identity verified; region ' + context.region);
const report = {
  preparedAt: new Date().toISOString(),
  region: context.region,
  accountId: identity.Account,
  stackName: 'classorbit-media',
  appOrigin: config.appUrl,
  templateSha256: createHash('sha256').update(template).digest('hex'),
  resources: Object.entries(JSON.parse(template).Resources).map(([name, r]) => ({
    name,
    type: r.Type,
  })),
  privateKeyFile: '.data/cloudfront/private.pem',
  publicKeyFile: '.data/cloudfront/public.pem',
  marketplaceResourcesModified: false,
  deploymentPerformed: false,
};
try {
  await new CloudFormationClient(context).send(
    new ValidateTemplateCommand({ TemplateBody: template }),
  );
  report.awsTemplateValidation = 'passed';
  console.log('AWS CloudFormation template validation passed');
} catch (error) {
  report.awsTemplateValidation = 'blocked';
  report.validationError = error.name;
  console.log('AWS template validation unavailable: ' + error.name);
}
await writeFile(
  path.join(directory, 'parameters.json'),
  JSON.stringify(
    [
      { ParameterKey: 'AppOrigin', ParameterValue: config.appUrl },
      { ParameterKey: 'SigningPublicKey', ParameterValue: publicKey },
      { ParameterKey: 'PriceClass', ParameterValue: 'PriceClass_100' },
    ],
    null,
    2,
  ),
);
await writeFile(path.join(directory, 'plan.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    prepared: true,
    resources: report.resources.length,
    region: report.region,
    templateValidation: report.awsTemplateValidation,
    deployed: false,
    plan: '.data/cloudfront/plan.json',
  }),
);
