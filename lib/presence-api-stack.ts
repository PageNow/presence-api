import * as path from "path";

import * as CDK from '@aws-cdk/core';
import * as EC2 from '@aws-cdk/aws-ec2';
import * as IAM from '@aws-cdk/aws-iam';
import * as ElasticCache from '@aws-cdk/aws-elasticache';
import * as Lambda from '@aws-cdk/aws-lambda';
import * as AppSync from '@aws-cdk/aws-appsync';
import * as AwsEvents from '@aws-cdk/aws-events';
import * as AwsEventsTargets from '@aws-cdk/aws-events-targets';
import * as Cognito from '@aws-cdk/aws-cognito';
import * as ApiGateway from '@aws-cdk/aws-apigateway';
import * as ApiGatewayV2 from '@aws-cdk/aws-apigatewayv2';
import * as RDS from '@aws-cdk/aws-rds';
import * as ApiGatewayIntegrations from '@aws-cdk/aws-apigatewayv2-integrations';

import { PresenceSchema } from "./schema";
import {
    pagenowVpcId, rdsProxySgId, cognitoPoolId, rdsDBName, rdsDBHost,
    rdsDBUser, rdsDBPassword, rdsDBPort, rdsProxyArn, rdsProxyName,
    privateSubnet1Id, privateSubnet2Id,
    privateRouteTableId, subnet1AZ, subnet2AZ
} from '../stack-consts';

// Interface used as parameter to create resolvers for API
interface ResolverOptions {
    source: string | AppSync.BaseDataSource,
    requestMappingTemplate?: AppSync.MappingTemplate,
    responseMappingTemplate?: AppSync.MappingTemplate
};

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
    private redisCluster: ElasticCache.CfnReplicationGroup;
    private redisPort: number = 6379;
    private rdsProxy: RDS.DatabaseProxy;
    readonly api: AppSync.GraphqlApi;

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
        isTestFunction: boolean = false
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
            fn.addEnvironment("REDIS_HOST",
                this.redisCluster.attrPrimaryEndPointAddress);
            fn.addEnvironment("REDIS_PORT",
                this.redisCluster.attrPrimaryEndPointPort);
        }
        if (usePostgres) {
            fn.addEnvironment("DB_USER", rdsDBUser!);
            fn.addEnvironment("DB_HOST", rdsDBHost!);
            fn.addEnvironment("DB_DATABASE", rdsDBName);
            fn.addEnvironment("DB_PASSWORD", rdsDBPassword!);
            fn.addEnvironment("DB_PORT", rdsDBPort.toString());
            this.rdsProxy.grantConnect(fn, rdsDBUser);
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
     * Creates a resolver.
     * 
     * A resolver attaches a data source to a specific field in the schema.
     * 
     * @param typeName - type (e.g. Query, Mutation)
     * @param fieldName - resolvable fields
     * @param options - ResolverOptions
     */
    private createResolver = (typeName: string, fieldName: string, options: ResolverOptions)
        :AppSync.BaseDataSource => {
        let source = (typeof(options.source) === 'string') ?
            this.api.addLambdaDataSource(`${options.source}DS`, this.getFn(options.source)) :
            options.source;

        source.createResolver({ typeName, fieldName, ...options });
        return source;
    }

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
            vpcId: pagenowVpcId
        }) as EC2.Vpc;

        this.privateSubnet1 = EC2.Subnet.fromSubnetAttributes(this, 'privateSubnet1', {
            subnetId: privateSubnet1Id!,
            routeTableId: privateRouteTableId,
            availabilityZone: subnet1AZ
        }) as EC2.Subnet;
        this.privateSubnet2 = EC2.Subnet.fromSubnetAttributes(this, 'privateSubnet2', {
            subnetId: privateSubnet2Id!,
            routeTableId: privateRouteTableId,
            availabilityZone: subnet2AZ
        }) as EC2.Subnet;

        const redisSubnet1 = new EC2.Subnet(this, 'redisSubnet1', {
            availabilityZone: 'us-west-2a',
            cidrBlock: '10.0.5.0/24',
            vpcId: pagenowVpcId!,
            mapPublicIpOnLaunch: false
        });
        const redisSubnet2 = new EC2.Subnet(this, 'redisSubnet2', {
            availabilityZone: 'us-west-2b',
            cidrBlock: '10.0.6.0/24',
            vpcId: pagenowVpcId!,
            mapPublicIpOnLaunch: false
        });

        /**
         * Security Groups
         */
        const rdsProxySG = EC2.SecurityGroup.fromLookup(this, "rdsProxySG", rdsProxySgId!);
        const redisSG = new EC2.SecurityGroup(this, "redisSg", {
            vpc: this.vpc,
            description: "Security group for Redis Cluster"
        });
        this.lambdaSG = new EC2.SecurityGroup(this, "lambdaSg", {
            vpc: this.vpc,
            description: "Security group for Lambda functions"
        });

        redisSG.addIngressRule(
            this.lambdaSG,
            EC2.Port.tcp(this.redisPort)
        );
        rdsProxySG.addIngressRule(
            this.lambdaSG,
            EC2.Port.tcp(rdsDBPort)
        );

        /**
         * Retrieve RDS Proxy
         */
        this.rdsProxy = RDS.DatabaseProxy.fromDatabaseProxyAttributes(this, "RDSProxy", {
            dbProxyArn: rdsProxyArn!,
            dbProxyName: rdsProxyName!,
            endpoint: rdsDBHost!,
            securityGroups: [rdsProxySG]
        }) as RDS.DatabaseProxy;

        /**
         * Redis cache cluster
         * 
         * Note those are level 1 constructs in CDK.
         * So props like `cacheSubnetGroupName` have misleading names and require a name 
         * in CloudFormation sense, which is actually a "ref" for reference.
         */
        const redisSubnets = new ElasticCache.CfnSubnetGroup(this, "RedisSubnets", {
            cacheSubnetGroupName: "RedisSubnets",
            description: "Subnet Group for Redis Cluster",
            subnetIds: [ redisSubnet1.subnetId, redisSubnet2.subnetId ]
        });
        this.redisCluster = new ElasticCache.CfnReplicationGroup(this, "PresenceCluster", {
            replicationGroupDescription: "PresenceReplicationGroup",
            cacheNodeType: "cache.t3.small",
            engine: "redis",
            numCacheClusters: 2,
            automaticFailoverEnabled: true,
            multiAzEnabled: true,
            cacheSubnetGroupName: redisSubnets.ref,
            securityGroupIds: [ redisSG.securityGroupId ],
            port: this.redisPort
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
            'get_presence', 'get_user_presence', 'update_presence'
        ].forEach(
            (fn) => { this.addFunction(fn) }
        );

        // Add Lambda test functions (for filling in initial data and testing)
        [ 
            'add_users', 'add_friendship', 'test_connect', 'test_heartbeat',
            'read_presence', 'read_user_info'
        ].forEach(
            (fn) => { this.addFunction(fn, true, true, true) }
        );

        /**
         * Event bus
         * - Invoke Lambda functions regularly
         */
        const presenceEventBus = new AwsEvents.EventBus(this, "PresenceEventBus");
        // Rule to trigger lambda timeout every minute
        new AwsEvents.Rule(this, "PresenceTimeoutRule", {
            schedule: AwsEvents.Schedule.cron({ hour: "*" }),
            targets: [ new AwsEventsTargets.LambdaFunction(this.getFn("timeout")) ],
            enabled: true
        });

        /**
         * Finalize configuration for Lambda functions
         * - Add environment variables to access api
         * - Add IAM policy statement for event bus access (putEvents)
         * - Add timeout
         */
        const allowEventBridge = new IAM.PolicyStatement({ effect: IAM.Effect.ALLOW });
        allowEventBridge.addActions("events:PutEvents");
        allowEventBridge.addResources(presenceEventBus.eventBusArn);

        this.getFn("timeout")
            .addEnvironment("TIMEOUT", "10000")
            .addEnvironment("EVENT_BUS", presenceEventBus.eventBusName)
            .addToRolePolicy(allowEventBridge);

        // this.getFn("disconnect")
        //     .addEnvironment("EVENT_BUS", presenceEventBus.eventBusName)
        //     .addToRolePolicy(allowEventBridge);

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

        this.getFn('heartbeat').addToRolePolicy(
            new IAM.PolicyStatement({
                actions: ['execute-api:ManageConnections'],
                resources: [connectionsArns]
            })
        );
        this.getFn('test_heartbeat').addToRolePolicy(
            new IAM.PolicyStatement({
                actions: ['execute-api:ManageConnections'],
                resources: [connectionsArns]
            })
        );

        /**
         * Retrieve existing user pool
         */
        // const userPool = Cognito.UserPool.fromUserPoolId(this, 'pagenow-userpool', cognitoPoolId!);
        // const apiAuthorizer = new ApiGateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
        //     cognitoUserPools: [ userPool ]
        // });

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