require('isomorphic-fetch'); // required for 'aws-appsync'
import stackData from '../../presence.json';

import * as AWSAppSync from "aws-appsync";
import gql from "graphql-tag";

// prepare all queries
const presenceResult = `{
    id
    status
}`;
const getStatus = gql`
    query getStatus($id: ID!) {
        status(id: $id) ${presenceResult}
    }
`;
const sendHeartbeat = gql`
    query heartbeat($id: ID!) {
        heartbeat(id: $id) ${presenceResult}
    }
`;
const connectPlayer = gql`
    mutation connectPlayer($id: ID!) {
        connect(id: $id) ${presenceResult}
    }
`;
const disconnectPlayer = gql`
    mutation disconnectPlayer($id: ID!) {
        disconnect(id: $id) ${presenceResult}
    }
`;;
const onChangeStatus = gql`
    subscription statusChanged($id: ID!) {
        onStatus(id: $id) ${presenceResult}
    }
`;

// client creation
export default class Api {
    private static _client : AWSAppSync.AWSAppSyncClient<any>;
    private static _stackOutput = stackData;

    constructor() {
        if (!Api._client) {
            Api._client = new AWSAppSync.AWSAppSyncClient({
                url: Api._stackOutput.PresenceApiStack.presenceapi,
                region: Api._stackOutput.PresenceApiStack.region,
                auth: {
                    // type: AWSAppSync.AUTH_TYPE.API_KEY,
                    // apiKey: Api._stackOutput.PresenceApiStack.apikey
                    type: AWSAppSync.AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
                    jwtToken: ''
                },
                disableOffline: true
            });
        }
    }

    static getConfig() {
        return this._stackOutput;
    }

    private _extract(field: string): any {
        return (result: {[f: string]: any}): any => {
            const { __typename, ...data } = result.data[field];
            return data;
        }
    }

    private async _mutate(id: string, gqlQuery: any, ret: string) {
        return Api._client.mutate({
            mutation: gqlQuery,
            variables: { id }
        }).then( this._extract(ret) );
    }

    private async _query(id: string, gqlQuery: any, ret: string) {
        return Api._client.query({
            query: gqlQuery,
            variables: { id }
        }).then( this._extract(ret) );
    }

    async connect(id: string) {
        return this._mutate(id, connectPlayer, "connect");
    }

    async disconnect(id: string) {
        return this._mutate(id, disconnectPlayer, "disconnect");
    }

    async status(id: string) {
        return this._query(id, getStatus, "status");
    }

    async heartbeat(id: string) {
        return this._query(id, sendHeartbeat, "heartbeat");
    }

    notify(id: string) {
        return Api._client.subscribe({
            query: onChangeStatus,
            variables: { id }
        });
    };
};
