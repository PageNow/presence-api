import * as path from "path";

import * as CDK from '@aws-cdk/core';
import * as EC2 from '@aws-cdk/aws-ec2';
import * as IAM from '@aws-cdk/aws-iam';
import * as ElasticCache from '@aws-cdk/aws-elasticache';
import * as Lambda from '@aws-cdk/aws-lambda';
import * as DDB from '@aws-cdk/aws-dynamodb';
import * as AwsEvents from '@aws-cdk/aws-events';
import * as AwsEventsTargets from '@aws-cdk/aws-events-targets';
import * as ApiGateway from '@aws-cdk/aws-apigateway';
import * as ApiGatewayV2 from '@aws-cdk/aws-apigatewayv2';
import * as RDS from '@aws-cdk/aws-rds';
import * as ApiGatewayIntegrations from '@aws-cdk/aws-apigatewayv2-integrations';

require('dotenv').config();

/**
 * class PresenceStack
 * 
 * Main stack of the application
 */
export class PresenceApiStack extends CDK.Stack {

    private vpc: EC2.Vpc;
    private privateSubnet1: EC2.Subnet;
    private privateSubnet2: EC2.Subnet;
    private lambdaSG: EC2.SecurityGroup;
    private lambdaLayer: Lambda.LayerVersion;
    private redisPrimaryEndpointAddress: string;
    private redisPrimaryEndpointPort: string;
    private redisReaderEndpointAddress: string;
    private redisReaderEndpointPort: string;
    private redisPort: number = 6379;
    private rdsProxy: RDS.DatabaseProxy;
    private userActivityHistoryTable: DDB.Table;

    // Lambda functions are stored by name
    private functions: { [key: string]: Lambda.Function } = {};

    /**
     * Adds a Lambda Function to an internal list of functions indexed by name.
     * The function code is assumed to be located in `../src/functions/${name}.js`.
     * 
     * Functions that require access to redis have "Redis Layer" attached.
     * 
     * @param name - name of the function
     * @param useRedis - whether the functino uses redis or not (requires layer/VPC/env_variables if so)
     */
    private addFunction = (
        name: string, useRedis: boolean = true, usePostgres: boolean = true,
        isTestFunction: boolean = false, useDynamoDb: boolean = false
    ): void => {
        const fn = new Lambda.Function(this, name, {
            vpc: this.vpc,
            vpcSubnets: { subnets: [ this.privateSubnet1, this.privateSubnet2 ] },
            securityGroups: [ this.lambdaSG ],
            code: Lambda.Code.fromAsset(path.resolve(__dirname, isTestFunction
                ? `../src/test_functions/${name}` : `../src/functions/${name}`)),
            runtime: Lambda.Runtime.NODEJS_12_X,
            handler: `${name}.handler`
        });
        fn.addLayers(this.lambdaLayer);
        if (useRedis) {
            fn.addEnvironment("REDIS_PRIMARY_HOST", this.redisPrimaryEndpointAddress);
            fn.addEnvironment("REDIS_PRIMARY_PORT", this.redisPrimaryEndpointPort);
            fn.addEnvironment("REDIS_READER_HOST", this.redisReaderEndpointAddress);
            fn.addEnvironment("REDIS_READER_PORT", this.redisReaderEndpointPort);
        }
        if (usePostgres) {
            fn.addEnvironment("DB_USER", process.env.RDS_USERNAME!);
            fn.addEnvironment("DB_HOST", process.env.RDS_HOST!);
            fn.addEnvironment("DB_DATABASE", process.env.RDS_DB_NAME!);
            fn.addEnvironment("DB_PASSWORD", process.env.RDS_PASSWORD!);
            fn.addEnvironment("DB_PORT", process.env.RDS_PORT!);
            this.rdsProxy.grantConnect(fn, process.env.RDS_USERNAME!);
        }
        if (useDynamoDb) {
            fn.addEnvironment("USER_ACTIVITY_HISTORY_TABLE_NAME", this.userActivityHistoryTable.tableName);
            this.userActivityHistoryTable.grantWriteData(fn);
        }
        this.functions[name] = fn;
    };

    /**
     * Retrieves the Lambda function by its name
     * 
     * @param name - name of the Lambda function
     */
    private getFn(name: string): Lambda.Function {
        return this.functions[name];
    };

    /**
     * Stack constructor
     * 
     * @param scope 
     * @param id 
     * @param props 
     */
    constructor(scope: CDK.Construct, id: string, props?: CDK.StackProps) {
        super(scope, id, props);

        this.vpc = EC2.Vpc.fromLookup(this, 'PresenceVPC', {
            isDefault: false,
            vpcId: process.env.VPC_ID!
        }) as EC2.Vpc;

        this.privateSubnet1 = EC2.Subnet.fromSubnetAttributes(this, 'privateSubnet1', {
            subnetId: process.env.PRIVATE_SUBNET1_ID!,
            routeTableId: process.env.PRIVATE_ROUTE_TABLE_ID!,
            availabilityZone: process.env.SUBNET1_AZ!
        }) as EC2.Subnet;
        this.privateSubnet2 = EC2.Subnet.fromSubnetAttributes(this, 'privateSubnet2', {
            subnetId: process.env.PRIVATE_SUBNET2_ID!,
            routeTableId: process.env.PRIVATE_ROUTE_TABLE_ID!,
            availabilityZone: process.env.SUBNET2_AZ!
        }) as EC2.Subnet;

        /**
         * Security Groups
         */
         if (process.env.LAMBDA_SG_ID === 'none') {
            this.lambdaSG = new EC2.SecurityGroup(this, "lambdaSg", {
                vpc: this.vpc,
                description: "Security group for Lambda functions"
            });
        } else {
            this.lambdaSG = EC2.SecurityGroup.fromLookup(
                this, "lambdaSG", process.env.LAMBDA_SG_ID!) as EC2.SecurityGroup;
        }
        
        if (process.env.REDIS_SG_ID !== 'none' && process.env.REDIS_PRIMARY_ENDPOINT_ADDRESS !== 'none'
                && process.env.REDIS_PRIMARY_ENDPOINT_PORT !== 'none') {
            this.redisPrimaryEndpointAddress = process.env.REDIS_PRIMARY_ENDPOINT_ADDRESS!;
            this.redisPrimaryEndpointPort = process.env.REDIS_PRIMARY_ENDPOINT_PORT!;
            this.redisReaderEndpointAddress = process.env.REDIS_READER_ENDPOINT_ADDRESS!;
            this.redisReaderEndpointPort = process.env.REDIS_READER_ENDPOINT_PORT!;
        } else {
            const redisSubnet1 = new EC2.Subnet(this, 'redisSubnet1', {
                availabilityZone: 'us-west-2a',
                cidrBlock: '10.0.5.0/24',
                vpcId: process.env.VPC_ID!,
                mapPublicIpOnLaunch: false
            });
            const redisSubnet2 = new EC2.Subnet(this, 'redisSubnet2', {
                availabilityZone: 'us-west-2b',
                cidrBlock: '10.0.6.0/24',
                vpcId: process.env.VPC_ID!,
                mapPublicIpOnLaunch: false
            });
            const redisSG = new EC2.SecurityGroup(this, "redisSg", {
                vpc: this.vpc,
                description: "Security group for Redis Cluster"
            });
            redisSG.addIngressRule(
                this.lambdaSG,
                EC2.Port.tcp(this.redisPort)
            );

            const redisSubnets = new ElasticCache.CfnSubnetGroup(this, "RedisSubnets", {
                cacheSubnetGroupName: "RedisSubnets",
                description: "Subnet Group for Redis Cluster",
                subnetIds: [ redisSubnet1.subnetId, redisSubnet2.subnetId ]
            });
            const redisCluster = new ElasticCache.CfnReplicationGroup(this, "PagenowCluster", {
                replicationGroupDescription: "PagenowReplicationGroup",
                cacheNodeType: "cache.t3.small",
                engine: "redis",
                numCacheClusters: 2,
                automaticFailoverEnabled: true,
                multiAzEnabled: true,
                cacheSubnetGroupName: redisSubnets.ref,
                securityGroupIds: [ redisSG.securityGroupId ],
                port: this.redisPort
            });

            this.redisPrimaryEndpointAddress = redisCluster.attrPrimaryEndPointAddress;
            this.redisPrimaryEndpointPort = redisCluster.attrPrimaryEndPointPort;
            this.redisReaderEndpointAddress = redisCluster.attrReaderEndPointAddress;
            this.redisReaderEndpointPort = redisCluster.attrReaderEndPointPort;
        }

        const rdsProxySG = EC2.SecurityGroup.fromLookup(this, "rdsProxySG", process.env.RDS_PROXY_SG_ID!);
        rdsProxySG.addIngressRule(
            this.lambdaSG,
            EC2.Port.tcp(parseInt(process.env.RDS_PORT!, 10))
        );
        this.rdsProxy = RDS.DatabaseProxy.fromDatabaseProxyAttributes(this, "RDSProxy", {
            dbProxyArn: process.env.RDS_PROXY_ARN!,
            dbProxyName: process.env.RDS_PROXY_NAME!,
            endpoint: process.env.RDS_HOST!!,
            securityGroups: [rdsProxySG]
        }) as RDS.DatabaseProxy;
        
        /**
         * DynamoDB Table
         */
         this.userActivityHistoryTable = new DDB.Table(this, 'UserActivityHistoryTable', {
            billingMode: DDB.BillingMode.PAY_PER_REQUEST,
            partitionKey: {
                name: 'user_id',
                type: DDB.AttributeType.STRING
            },
            sortKey: {
                name: 'timestamp',
                type: DDB.AttributeType.STRING
            }
        });

        /**
         * Lambda functions creation
         * - Define the layer to add nodejs layer module
         * - Add the functions
         */
        this.lambdaLayer = new Lambda.LayerVersion(this, "lambdaModule", {
            code: Lambda.Code.fromAsset(path.join(__dirname, '../src/layer')),
            compatibleRuntimes: [Lambda.Runtime.NODEJS_12_X],
            layerVersionName: "presenceLayer"
        });

        // Add Lambda functions
        [ 
            'heartbeat', 'timeout', 'connect', 'disconnect', 'close_connection',
            'get_presence', 'get_user_presence'
        ].forEach(
            (fn) => { this.addFunction(fn) }
        );

        // Add Lambda functions with DynamoDB table
        [ 'update_presence' ].forEach((fn) => {
            this.addFunction(fn, true, true, false, true)
        });

        // Add Lambda test functions (for filling in initial data and testing)
        [ 
            'add_users', 'add_friendship', 'test_connect',
            'read_presence', 'read_user_info', 'test_sql',
            'test_timeout', 'update_profile_image_info'
        ].forEach(
            (fn) => { this.addFunction(fn, true, true, true) }
        );

        [ 'test_update_presence' ].forEach((fn) => {
            this.addFunction(fn, true, true, true, true);
        })

        /**
         * Event bus
         * - Invoke Lambda functions regularly
         */
        const presenceEventBus = new AwsEvents.EventBus(this, "PresenceEventBus");
        // Rule to trigger lambda timeout every minute
        new AwsEvents.Rule(this, "PresenceTimeoutRule", {
            schedule: AwsEvents.Schedule.rate(CDK.Duration.minutes(3)),
            targets: [ new AwsEventsTargets.LambdaFunction(this.getFn("timeout")) ],
            enabled: true
        });

        /**
         * Finalize configuration for Lambda functions
         * - Add environment variables to access api
         * - Add IAM policy statement for event bus access (putEvents)
         * - Add timeout
         */
        // const allowEventBridge = new IAM.PolicyStatement({ effect: IAM.Effect.ALLOW });
        // allowEventBridge.addActions("events:PutEvents");
        // allowEventBridge.addResources(presenceEventBus.eventBusArn);

        /**
         * API Gateway for real-time presence websocket
         */
        const webSocketApi = new ApiGatewayV2.WebSocketApi(this, 'PresenceWebsocketApi', {
            connectRouteOptions: {
                integration: new ApiGatewayIntegrations.LambdaWebSocketIntegration({
                    handler: this.getFn('connect')
                })
            },
            disconnectRouteOptions: {
                integration: new ApiGatewayIntegrations.LambdaWebSocketIntegration({
                    handler: this.getFn('close_connection')
                })
            }
        });
        webSocketApi.addRoute('heartbeat', {
            integration: new ApiGatewayIntegrations.LambdaWebSocketIntegration({
                handler: this.getFn('heartbeat')
            })
        });
        webSocketApi.addRoute('update-presence', {
            integration: new ApiGatewayIntegrations.LambdaWebSocketIntegration({
                handler: this.getFn('update_presence')
            })
        });
        const apiStage = new ApiGatewayV2.WebSocketStage(this, 'DevStage', {
            webSocketApi,
            stageName: 'dev',
            autoDeploy: true,
        });

        const connectionsArns = this.formatArn({
            service: 'execute-api',
            resourceName: `${apiStage.stageName}/POST/*`,
            resource: webSocketApi.apiId,
        });

        [ 'update_presence', 'test_update_presence', 'timeout', 'test_timeout' ].forEach(fn => {
            this.getFn(fn).addToRolePolicy(
                new IAM.PolicyStatement({
                    actions: ['execute-api:ManageConnections'],
                    resources: [connectionsArns]
                })
            );
        });

        this.getFn("timeout")
            .addEnvironment("TIMEOUT", "180000")
            .addEnvironment("WSS_DOMAIN_NAME", webSocketApi.apiEndpoint)
            .addEnvironment("WSS_STAGE", apiStage.stageName);
            // .addToRolePolicy(allowEventBridge);

        /**
         * API Gateway for Presence REST endpoint
         */
        const restApi = new ApiGateway.RestApi(this, 'PresenceRestApi', {
            deploy: true,
            deployOptions: {
                stageName: 'dev'
            },
            defaultCorsPreflightOptions: {
                allowHeaders: [
                  'Content-Type',
                  'X-Amz-Date',
                  'Authorization',
                  'X-Api-Key',
                ],
                allowMethods: ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
                allowCredentials: true,
                allowOrigins: ['http://localhost:4200'],
            },
            // defaultMethodOptions: {
            //     authorizationType: ApiGateway.AuthorizationType.COGNITO,
            //     authorizer: apiAuthorizer,
            // }
        });

        const presenceRestResource = restApi.root.addResource('presence');
        presenceRestResource.addMethod(
            'GET',
            new ApiGateway.LambdaIntegration(this.getFn('get_presence'), { proxy: true })
        );

        const userPresenceRestResource = presenceRestResource.addResource('{userId}');
        userPresenceRestResource.addMethod(
            'GET',
            new ApiGateway.LambdaIntegration(this.getFn('get_user_presence'), { proxy: true })
        );


        /**
         * CloudFormation stack output
         * Use the `-O, --output-file` option with `cdk deploy` to output those in a JSON file
         * or use `npm run deploy` to use this option as default
         */
        new CDK.CfnOutput(this, 'websocketApiUrl', {
            value: webSocketApi.apiEndpoint
        });
        new CDK.CfnOutput(this, 'restApiUrl', {
            value: restApi.url
        });
    }
}