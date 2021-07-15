# presence-api
API for presence information

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
 
## TODO

[] Change authorization to COGNITO
[] Save and load the current url / page title to REDIS 

## References

* https://github.com/aws-samples/aws-appsync-presence-api
* https://aws.amazon.com/ko/blogs/gametech/building-a-presence-api-using-aws-appsync-aws-lambda-amazon-elasticache-and-amazon-eventbridge/
