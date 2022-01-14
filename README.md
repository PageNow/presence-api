[한국어 README.md](./README_KO.md)

PageNow Home Page: https://pagenow.io <br/>
PageNow Chrome Web Store: https://chrome.google.com/webstore/detail/pagenow/lplobiaakhgkjcldopgkbcibeilddbmc

# Presence API

[![CircleCI](https://circleci.com/gh/PageNow/presence-api/tree/main.svg?style=svg&circle-token=5e7032cef952ec6e36876b894bff5d81afc0d643)](https://circleci.com/gh/PageNow/presence-api/tree/main)
[![codecov](https://codecov.io/gh/PageNow/presence-api/branch/main/graph/badge.svg?token=GT0M89PL1B)](https://codecov.io/gh/PageNow/presence-api)

Presence API provides functionalities to deal with real-time presence information. It is an extended version of the 'Active n hours ago' feature of Messenger. Presence API provides a REST API to retrieve friends' current activites and a WebSocket API to listen to friends' and send the user's activity updates.

Presence API is built using AWS CDK with TypeScript.

## Architecture

### API Architecture Overview Diagram

![presence_api_overview](./images/presence_api_overview.png)

### API Architecture Details Diagram

![presence_api_details](./images/presence_api_details.png)

## Components

The system architecture and its relevant cloud deployment details are defined in [lib/presence-api-stack.ts](./lib/presence-api-stack.ts). Lambda functions are stored in [src/functions](./src/functions/) with the Lambda layer in [src/layer](./src/layer/).

### AWS RDS (PostgreSQL)

* AWS RDS is connected via AWS RDS Proxy.

* The RDS database schema is defined in [user-api](https://github.com/PageNow/user-api).

* The permission for Lambda to access AWS RDS Postgres is set up in [lib/presence-api-stack.ts](./lib/presence-api-stack.ts).

### AWS Elasticache (Redis)

We use a single REDIS client cluster with four keys - `presence_user_connection`, `presence_connection_user`, `status`, `page`.

* `presence_user_connection` stores { user_id: connection_id } and `presence_connection_user` stores { connection_id: user_id }. They are used to manage connection ids for each user.

* `status` stores { user_id: timestamp } with timestamp as score. It is used to determine whether a user is online or not.

* `presence` stores { user_id: page string } where page string is a JSON string of { url: string, title: string }. It is the _url_ and _title_ of tabs users are on.

### AWS Lambda

All the presence functionalities are built with AWS Lambda functions.

* `connect` is invoked via websocket when a user connects to it. It stores the user's connection id in *presence_user_connection* and *presence_connection_user* Redis key.

* `heartbeat` is invoked every minute via websocket from the Chrome extension. It updates the timestamp of _status_ Redis key.

* `update_presence` is invoked via websocket when user switches the Chrome page. It updates timestamp of *status* Redis key and page information of *page* Redis key.

* `close_connection` is invoked via websocket when user closes websocket connection. It removes user's information (connection id, timestamp, and page information) from all Redis keys. 

* `timeout` is invoked every 3 minutes by AWS Eventbridge to identify offline users and remove their information from Redis.

* `get_presence` is invoked via REST Api. It returns the presence information of every friend of the user who invokes the function.

* `get_user_presence` is invoked via REST Api. It returns the presence information of the target user provided by the caller.

### AWS API Gateway

* REST API - Provides endpoint for retrieving the current snapshot of presence data of users.

* Websocket API - Provides websocket connection for Chrome extension `background.js` to send and retrieve real-time presence data.

### AWS EventBridge

CloudWatch triggers EventBridge event every 3 minutes to invoke Lambda `timeout` function. A user who has not been active for the last 3 minutes is treated as offline.

## Setup

### Environment Variables

In `.env` set the following environment variables.
```
AWS_REGION=<AWS region>
COGNITO_POOL_ID=<AWS Cognito User Pool Id>

VPC_ID=<VPC of the backend>
PRIVATE_ROUTE_TABLE1_ID=<Route Table1 id of subnets AWS RDS resides in>
PRIVATE_ROUTE_TABLE2_ID=<Route Table2 id of subnets AWS RDS resides in>
PRIVATE_SUBNET1_ID=<Id of subnet1 AWS RDS resides in>
PRIVATE_SUBNET2_ID=<Id of subnet2 AWS RDS resides in>

SUBNET1_AZ=<Availability zone of subnet1 (e.g. us-west-2a)>
SUBNET2_AZ=<Availability zone of subnet2>

RDS_PROXY_SG_ID=<Security Group of AWS RDS Proxy>
RDS_HOST=<AWS RDS Host>
RDS_PORT=<AWS RDS Port Number>
RDS_USERNAME=<AWS RDS username>
RDS_PASSWORD=<AWS RDS password>
RDS_DB_NAME=<AWS RDS database name>

RDS_PROXY_ARN=<AWS RDS Proxy arn>
RDS_PROXY_NAME=<AWS RDS Proxy name>

LAMBDA_SG_ID=<AWS Lambda Security Group if it exists. 'none' otherwise>
REDIS_SG_ID=<AWS Elasticache Security Group if it exists. 'none' otherwise>
REDIS_PRIMARY_ENDPOINT_ADDRESS=<Elasticache primary endpoint host if it exists. 'none' otherwise>
REDIS_PRIMARY_ENDPOINT_PORT=<Elasticache primary endpoint port if it exists. 'none' otherwise>
REDIS_READER_ENDPOINT_ADDRESS=<Elasticache reader endpoint host if it exists. 'none' otherwise>
REDIS_READER_ENDPOINT_PORT=<Elasticache reader endpoint port if it exists. 'none' otherwise>

CLIENT_URL=<Url of the chat client>
```

### CDK Bootstrap

For initialization, bootstrap AWS CDK by running
```shell
cdk bootstrap aws://<AWS Account Id>/<AWS Region>
```
Refer to https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html for more details.

## Running Locally

### Run Redis on Docker

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

## Deployment

Run
```shell
cdk deploy --outputs-file presence.json
```
