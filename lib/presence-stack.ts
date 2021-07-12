import * as CDK from '@aws-cdk/core';
import * as EC2 from '@aws-cdk/aws-ec2';
import * as IAM from '@aws-cdk/aws-iam';
import * as ElasticCache from '@aws-cdk/aws-elasticache';
import * as Lambda from '@aws-cdk/aws-lambda';
import * as AppSync from '@aws-cdk/aws-appsync';

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
export class PresenceStack extends CDK.Stack {

    private vpc: EC2.Vpc;
    private lambdaSG: EC2.SecurityGroup;
    private redisClsuter: ElasticCache.CfnReplicationGroup;
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
    private addFunction(name: string, useRedis: boolean = true): void {

    }
}