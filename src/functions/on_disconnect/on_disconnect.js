/**
 * `on_disconnect` function requires an AppSync client
 * It is installed as node modules within its own folder
 */
require('isomorphic-fetch'); // used for 'aws-appsync
const AWS = require('aws-sdk/global');
const AppSync = require('aws-appsync');
const AppSyncClient = AppSync.default;
const AUTH_TYPE = AppSync.AUTH_TYPE;
const gql = require('graphql-tag');

const graphqlEndpoint = process.env.GRAPHQL_ENDPOINT;

// Initialize GraphQL client with IAM credentials
const config = {
    url: graphqlEndpoint,
    region: process.env.AWS_REGION,
    auth: {
        type: AUTH_TYPE.AWS_IAM,
        credentials: AWS.config.credentials
    },
    disableOffline: true
};
const gqlClient = new AppSyncClient(config);

// Query is the same for all calls
const disconnected = gql`
    mutation disconnected($userId: ID!) {
        disconnected(userId: $userId) {
            userId
            status
            url
            title
        }
    }
`

/**
 * Disconnection handler
 *
 * 1. Check `arguments.id` from the event
 * 2. Call the `disconnected` mutation on AppSync client
 */
exports.handler = async function(event) {
    const userId = event && event.detail && event.detail.userId;
    if (userId === undefined || userId === null) {
        throw new Error("Missing argument 'userId'");
    }

    try {
        const result = await gqlClient.mutate({
            mutation: disconnected,
            variables: { userId }
        });
        return result.data.disconnected;
    } catch (error) {
        console.log(error);
        return error;
    }
}
