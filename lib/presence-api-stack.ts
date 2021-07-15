import * as path from "path";

import * as CDK from '@aws-cdk/core';
import * as EC2 from '@aws-cdk/aws-ec2';
import * as IAM from '@aws-cdk/aws-iam';
import * as ElasticCache from '@aws-cdk/aws-elasticache';
import * as Lambda from '@aws-cdk/aws-lambda';
import * as AppSync from '@aws-cdk/aws-appsync';
import * as AwsEvents from '@aws-cdk/aws-events';
import * as AwsEventsTargets from '@aws-cdk/aws-events-targets';

import { PresenceSchema } from "./schema";

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
    private lambdaSG: EC2.SecurityGroup;
    private redisCluster: ElasticCache.CfnReplicationGroup;
    private redisLayer: Lambda.LayerVersion;
    private redisPort: number = 6379;
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
    private addFunction = (name: string, useRedis: boolean = true): void => {
        const props = useRedis ? {
            vpc: this.vpc,
            vpcSubnets: this.vpc.selectSubnets({subnetGroupName: "Lambda"}),
            securityGroups: [this.lambdaSG]
        } : {};
        const fn = new Lambda.Function(this, name, {
            ...props,
            code: Lambda.Code.fromAsset(path.resolve(__dirname, `../src/functions/${name}`)),
            runtime: Lambda.Runtime.NODEJS_12_X,
            handler: `${name}.handler`
        });
        if (useRedis) {
            fn.addLayers(this.redisLayer);
            fn.addEnvironment("REDIS_HOST", this.redisCluster.attrPrimaryEndPointAddress);
            fn.addEnvironment("REDIS_PORT", this.redisCluster.attrPrimaryEndPointPort);
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

        /**
         * Network
         * 
         * Defines a VPC with two subnet groups.
         * The CDK automatically creates subnets in at least 2 AZs by default.
         * Subnet types can be:
         * - ISOLATED: fully isolated
         * - PRIVATE: could be used for a Lambda function that would require internet access through a NAT Gateway
         * - PUBLIC: required if there is a PRIVATE subnet to setup a NAT Gateway
         */
        this.vpc = new EC2.Vpc(this, 'PresenceVPC', {
            cidr: "10.42.0.0/16",
            subnetConfiguration: [
                // Subnet group for REDIS
                {
                    cidrMask: 24,
                    name: "Redis",
                    subnetType: EC2.SubnetType.ISOLATED
                },
                // Subnet group for Lambda functions
                {
                    cidrMask: 24,
                    name: "Lambda",
                    subnetType: EC2.SubnetType.ISOLATED
                }
            ]
        });

        // Two security groups: one for redis cluster and one for lambda function
        const redisSG = new EC2.SecurityGroup(this, "redisSG", {
            vpc: this.vpc,
            description: "Security group for REDIS Cluster"
        });
        this.lambdaSG = new EC2.SecurityGroup(this, "lambdaSg", {
            vpc: this.vpc,
            description: "Security group for Lambda functions"
        });
        // REDIS SG accepts TCP connections from the Lambda SG on Redis port.
        redisSG.addIngressRule(
            this.lambdaSG,
            EC2.Port.tcp(this.redisPort)
        );

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
            subnetIds: this.vpc.selectSubnets({ subnetGroupName: "Redis" }).subnetIds
        });
        this.redisCluster = new ElasticCache.CfnReplicationGroup(this, "PresenceCluster", {
            replicationGroupDescription: "PresenceReplicationGroup",
            cacheNodeType: "cache.t3.small",
            engine: "redis",
            numCacheClusters: 2,
            automaticFailoverEnabled: true,
            multiAzEnabled: true,
            cacheSubnetGroupName: redisSubnets.ref,
            securityGroupIds: [redisSG.securityGroupId],
            port: this.redisPort
        });

        /**
         * Lambda functions creation
         * - Define the layer to add nodejs redis module
         * - Add the functions
         */
        this.redisLayer = new Lambda.LayerVersion(this, "redisModule", {
            code: Lambda.Code.fromAsset(path.join(__dirname, '../src/layer')),
            compatibleRuntimes: [Lambda.Runtime.NODEJS_12_X],
            layerVersionName: "presenceLayer"
        });
        ['heartbeat', 'status', 'disconnect', 'timeout'].forEach(
            (fn) => { this.addFunction(fn) }
        );
        this.addFunction("on_disconnect", false);

        /**
         * GraphQL API
         */
        this.api = new AppSync.GraphqlApi(this, "PresenceAPI", {
            name: "PresenceAPI",
            authorizationConfig: {
                // TODO: change to COGNITO                
                defaultAuthorization: {
                    authorizationType: AppSync.AuthorizationType.API_KEY,
                    apiKeyConfig: {
                        name: "PresenceKey",
                        expires: CDK.Expiration.after(CDK.Duration.days(1))
                    }
                },
                additionalAuthorizationModes: [
                    { authorizationType: AppSync.AuthorizationType.IAM }
                ]
            },
            schema: PresenceSchema(),
            logConfig: { fieldLogLevel: AppSync.FieldLogLevel.ALL }
        });

        // Configure sources and resolvers
        const heartbeatDS = this.createResolver("Query", "heartbeat", { source: "heartbeat" });
        this.createResolver("Query", "status", { source: "status" });
        this.createResolver("Mutation", "connect", { source: heartbeatDS });
        this.createResolver("Mutation", "disconnect", { source: "disconnect" });

        /**
         * Configure "disconnected" mutation
         * 
         * "disconnected" mutation is called on disconnection and is subscribed by AppSync client.
         * It uses a NoneDataSource with simple templates passing its argument so that it
         * triggers notifications.
         */
        const noneDS = this.api.addNoneDataSource("disconnectedDS");
        const requestMappingTemplate = AppSync.MappingTemplate.fromString(`
            {
                "version": "2017-02-28",
                "payload": {
                    "id": "$context.arguments.id",
                    "status": "offline"
                }
            }
        `);
        const responseMappingTemplate = AppSync.MappingTemplate.fromString(`
            $util.toJson($context.result)
        `);
        this.createResolver("Mutation", "disconnected", {
            source: noneDS,
            requestMappingTemplate,
            responseMappingTemplate
        });

        /**
         * Event bus
         */
        const presenceBus = new AwsEvents.EventBus(this, "PresenceBus");
        // Rule to trigger lambda timeout every minute
        new AwsEvents.Rule(this, "PresenceTimeoutRule", {
            schedule: AwsEvents.Schedule.cron({ minute: "*" }),
            targets: [ new AwsEventsTargets.LambdaFunction(this.getFn("timeout")) ],
            enabled: true
        });
        // Rule for disconnection event - triggers on_disconnect lambda function
        // according to the given pattern
        new AwsEvents.Rule(this, "PresenceDisconnectRule", {
            eventBus: presenceBus,
            description: "Rule for presence disconnection",
            eventPattern: {
                detailType: ["presence.disconnected"],
                source: ["api.presence"]
            },
            targets: [ new AwsEventsTargets.LambdaFunction(this.getFn("on_disconnect")) ],
            enabled: true
        });
        // Add an interface endpoint for EventBridge
        // Allows the lambda inside VPC to call EventBridge without requiring a NAT Gateway
        // Requires a security group that allows TCP 80 communications from the Lambda security groups
        const eventsEndPointSG = new EC2.SecurityGroup(this, "eventsEndPointSG", {
            vpc: this.vpc,
            description: "EventBridge interface endpoint SG"
        });
        eventsEndPointSG.addIngressRule(this.lambdaSG, EC2.Port.tcp(80));
        this.vpc.addInterfaceEndpoint("eventsEndPoint", {
            service: EC2.InterfaceVpcEndpointAwsService.CLOUDWATCH_EVENTS,
            subnets: this.vpc.selectSubnets({ subnetGroupName: "Lambda" }),
            securityGroups: [ eventsEndPointSG ]
        });

        /**
         * Finalize configuration for Lambda functions
         * - Add environment variables to access api
         * - Add IAM policy statement for GraphQL access
         * - Add IAM policy statement for event bus access (putEvents)
         * - Add timeout
         */
        const allowEventBridge = new IAM.PolicyStatement({ effect: IAM.Effect.ALLOW });
        allowEventBridge.addActions("events:PutEvents");
        allowEventBridge.addResources(presenceBus.eventBusArn);

        this.getFn("timeout").addEnvironment("TIMEOUT", "10000")
            .addEnvironment("EVENT_BUS", presenceBus.eventBusName)
            .addToRolePolicy(allowEventBridge);

        this.getFn("disconnect")
            .addEnvironment("EVENT_BUS", presenceBus.eventBusName)
            .addToRolePolicy(allowEventBridge);

        this.getFn("heartbeat")
            .addEnvironment("EVENT_BUS", presenceBus.eventBusName)
            .addToRolePolicy(allowEventBridge);

        const allowAppSync = new IAM.PolicyStatement({ effect: IAM.Effect.ALLOW });
        allowAppSync.addActions("appsync:GraphQL");
        allowAppSync.addResources(this.api.arn + "/*");
        this.getFn("on_disconnect")
            .addEnvironment("GRAPHQL_ENDPOINT", this.api.graphqlUrl)
            .addToRolePolicy(allowAppSync);

        /**
         * CloudFormation stack output
         * 
         * Contains:
         * - GraphQL API Endpoint
         * - API Key for the integration tests (could be removed in production)
         * - Region (required to configure AppSync client in integration tests)
         * 
         * Use the `-O, --output-file` option with `cdk deploy` to output those in a JSON file
         * or use `npm run deploy` to use this option as default
         */
        new CDK.CfnOutput(this, "presence-api", {
            value: this.api.graphqlUrl,
            description: "Presence api endpoint",
            exportName: "preseenceEndpoint"
        });
        new CDK.CfnOutput(this, "api-key", {
            value: this.api.apiKey || '',
            description: "Presence api key",
            exportName: "apiKey"
        });
        new CDK.CfnOutput(this, "region", {
            value: process.env.CDK_DEFAULT_REGION || '',
            description: "Presence api region",
            exportName: "region"
        });
    }
}