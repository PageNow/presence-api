import {
    expect as expectCDK, haveResource, haveOutput, Capture, countResources, haveResourceLike, objectLike
} from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as Presence from '../../lib/presence-api-stack';

const app = new cdk.App();
const stack = new Presence.PresenceApiStack(app, 'TestStack');

describe('GraphQLAPI and Stack Output', () => {
    test("GraphQL API exists", () => {
        expectCDK(stack).to(haveResource('AWS::AppSync::GraphQLApi'));
    });
    const name = stack.getLogicalId(stack.api.node.defaultChild as cdk.CfnElement);
    test("Output GraphQL url", () => {
        expectCDK(stack).to(haveOutput({
            outputName: 'presenceapi',
            exportName: 'presenceEndpoint',
            outputValue: {
                'Fn::GetAtt': [
                    name,
                    'GraphQLUrl'
                ]
            }
        }));
    });
});

describe("Checking GraphQL schema", () => {
    const definition = Capture.aString();
    const testNoSpaces = (s: string) => () => {
        const expr = s.replace(/\s+/g,'\\s*').replace(/([()\[\]])/g,'\\$1');
        expect(definition.capturedValue).toMatch(new RegExp(expr));
    };

    test("Schema inlined", () => {
        expectCDK(stack).to(haveResource('AWS::AppSync::GraphQLSchema', {
            Definition: definition.capture()
        }));
    });

    test("Basic types", testNoSpaces(`schema {
        query: Query
        mutation: Mutation
        subscription: Subscription
    }`));

    test("Status enum", testNoSpaces(`enum Status {
        online
        offline
    }`));

    test("Presence type", testNoSpaces(`type Presence @aws_cognito_user_pools @aws_iam {
        userId: ID!
        status: Status!
        url: String!
        title: String!
    }`));

    test("Queries", testNoSpaces(`type Query {
        heartbeat(url: String! title: String!): Presence
        status(userId: ID!): Presence
    }`));

    test("Mutations", testNoSpaces(`type Mutation {
        connect(url: String! title: String!): Presence
        disconnect: Presence
        disconnected(userId: ID!): Presence
        @aws_iam
    }`));

    test("Subscriptions", testNoSpaces(`type Subscription {
        onStatus(userId: ID!): Presence
        @aws_subscribe(mutations: [\"connect\", \"disconnected\"])
    }`));
});

describe("Lambda functions", () => {
    test("Define 5 lambdas", () => {
        expectCDK(stack).to(countResources("AWS::Lambda::Function", 5));
    });
    test("Checking some lambdas", () => {
        expectCDK(stack).to(haveResourceLike("AWS::Lambda::Function", {
            Handler: "timeout.handler",
            Environment: {
                Variables: objectLike({ TIMEOUT: "10000" })
            }
        }));
    });
});