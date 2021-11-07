# presence-api
API for presence information

## Architecture

### REDIS

* We need to use two REDIS clients - one (presence) for storing { userId: timestamp } and one (status) for storing { userId: pageInfo } where pageInfo is a stringified JSON of { url: string, title: string }

### Event Flow

* Every minute, AWS Events calls timeout lambda function, which is put as an EventBridge event, which calls on_disconnect lambda function. 

* connect.js will be called when the url changes and on the initial connection. heartbeat.js will be called by the page if it has the same url as the redisUrl.

## CDK Bootstrap

```shell
cdk bootstrap aws://257206538165/us-east-1
```
Refer to https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html for more details.

## Useful CDK commands

The `cdk.json` file tells the CDK Toolkit how to execute your app.

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template

## Tests

* ```npm run test-stack```: build and launch stack unit tests
* ```npm run test-fn```: build and launch the lambda function unit tests
* ```npm run test-integration```: build and launch the api integration tests
 
## Local Testing

### Run REDIS with docker locally

Run
```shell
cd redis-docker
docker-compose up -d
```

### Invoke Lambda Functions

Run ```cdk synth --no-staging > template.yaml``` to generate template.yaml.

Check the function identifier from template.yaml and run
```shell
/usr/local/bin/sam local invoke [FunctionIdentifier] -e events/[event.json]
```

## TODO

[] Change authorization to COGNITO
[] Save and load the current url / page title to REDIS 

## References

* https://github.com/aws-samples/aws-appsync-presence-api
* https://aws.amazon.com/ko/blogs/gametech/building-a-presence-api-using-aws-appsync-aws-lambda-amazon-elasticache-and-amazon-eventbridge/

### Local testing

* https://github.com/aws/aws-sam-cli/issues/318#issuecomment-377770815

### APIGateway Websocket

* https://aws.plainenglish.io/setup-api-gateway-websocket-api-with-cdk-c1e58cf3d2be
* https://docs.aws.amazon.com/cdk/api/latest/docs/aws-apigatewayv2-readme.html#websocket-api
* https://docs.aws.amazon.com/cdk/api/latest/docs/aws-apigatewayv2-readme.html#websocket-api
* https://github.com/aws-samples/simple-websockets-chat-app/blob/master/onconnect/app.js

### VPC Import

* https://bobbyhadz.com/blog/import-existing-vpc-aws-cdk

### Lambda RDS Proxy
* https://itnext.io/work-with-aws-rds-proxy-9d7e09668080

### JWT decoding

* https://github.com/awslabs/aws-support-tools/tree/master/Cognito/decode-verify-jwt

### Testing

## Questions

* Does AppSync verify JWT token? If not, we have to verify manually on Lambda functions... (assume they verify JWT token for now)