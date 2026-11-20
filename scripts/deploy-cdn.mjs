import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  waitUntilStackCreateComplete,
} from '@aws-sdk/client-cloudformation';
import { awsContext } from './lib/aws-context.mjs';
import { config } from '../server/src/config/index.js';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--apply') continue;
  if (!['--credentials-env', '--region'].includes(args[i]) || !args[++i])
    throw new Error('Use --apply, --credentials-env <file>, --region <region>.');
}
const directory = path.join(config.root, '.data/cloudfront');
const plan = JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8'));
console.log(
  JSON.stringify({
    stack: plan.stackName,
    region: plan.region,
    resources: plan.resources,
    marketplaceResourcesModified: false,
    pricing: 'AWS usage-based resources; check your account allowances.',
  }),
);
if (!args.includes('--apply')) {
  console.log('Plan only. Review the template and use --apply to create the stack.');
  process.exit(0);
}
const context = await awsContext(args);
if (context.region !== plan.region) throw new Error('Use the region recorded by cdn:prepare.');
const template = await readFile(path.join(config.root, 'infra/aws/media-stack.json'), 'utf8');
if (createHash('sha256').update(template).digest('hex') !== plan.templateSha256)
  throw new Error('Template changed. Run cdn:prepare again before applying.');
const identity = await new STSClient(context).send(new GetCallerIdentityCommand({}));
if (identity.Account !== plan.accountId)
  throw new Error('AWS account differs from the prepared plan.');
const client = new CloudFormationClient(context);
const parameters = JSON.parse(await readFile(path.join(directory, 'parameters.json'), 'utf8'));
await client.send(
  new CreateStackCommand({
    StackName: plan.stackName,
    TemplateBody: template,
    Parameters: parameters,
    OnFailure: 'ROLLBACK',
    Tags: [{ Key: 'Application', Value: 'ClassOrbit' }],
  }),
);
console.log('Stack creation started. Waiting for AWS deployment...');
await waitUntilStackCreateComplete(
  { client, maxWaitTime: 1200, minDelay: 15, maxDelay: 30 },
  { StackName: plan.stackName },
);
const result = await client.send(new DescribeStacksCommand({ StackName: plan.stackName }));
const outputs = Object.fromEntries(
  result.Stacks[0].Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);
await writeFile(path.join(directory, 'outputs.json'), JSON.stringify(outputs, null, 2));
const settings = {
  AWS_REGION: context.region,
  S3_BUCKET: outputs.S3Bucket,
  CLOUDFRONT_URL: outputs.CloudFrontURL,
  CLOUDFRONT_KEY_PAIR_ID: outputs.CloudFrontPublicKeyId,
  CLOUDFRONT_PRIVATE_KEY_FILE: '.data/cloudfront/private.pem',
  CLOUDFRONT_AUTH_MODE: 'urls',
  CLOUDFRONT_URL_TTL: '900',
};
await writeFile(
  path.join(directory, 'cloudfront.env'),
  Object.entries(settings)
    .map(([k, v]) => k + '=' + v)
    .join('\n') + '\n',
);
console.log(
  'Stack ready. Outputs and environment snippet are saved in .data/cloudfront. Sync existing videos before enabling CloudFront playback.',
);
