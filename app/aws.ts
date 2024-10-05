import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const region = 'us-west-2'; // TODO: make this configurable

export function createStsClient({ accessKey, secret }: { accessKey: string, secret: string }) {
  const stsClient = new STSClient({ 
    region: region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secret
    }
  });

  stsClient.send(new GetCallerIdentityCommand({}))
    .then((data) => {
      console.log("AWS credentials verified. Account ID:", data.Account);
    })
    .catch((error) => {
      console.error("Failed to verify AWS credentials:", error);
    });
}
