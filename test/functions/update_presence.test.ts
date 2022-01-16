const { promisify } = require('util');
import { Client } from 'pg';
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as update_presence from '../../src/functions/update_presence/update_presence';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER, REDIS_KEY_PAGE,
    REDIS_KEY_LATEST_PAGE, REDIS_KEY_STATUS
} from '../../src/layer/nodejs/constants';
import { WSS_CONFIG, POSTGRES_CONFIG, DYNAMO_DB_CONFIG } from '../utils/config';
import {
    USER_ID1, USER_ID2, USER_ID3, USER_ID4, SHARED_PAGE1, SHARED_PAGE2, SHARED_PAGE1_DOMAIN,
    CONNECTION_ID1, CONNECTION_ID2, CONNECTION_ID3, EMPTY_PAGE
} from '../utils/data';
import { FRIENDSHIP_TABLE_CREATE_SQL } from '../utils/sql';

// mock Redis
jest.mock('redis', () => mockRedis);

// mock AWS services
const mockPutItem = jest.fn(() => {
    return {
        promise: jest.fn(() => "AWS.DynamoDB.putItem() called")
    };
});
const mockPostToConnection = jest.fn(() => {
    return {
        promise: jest.fn(() => "AWS.ApiGatewayManagementApi.postToConnection() called")
    };
});
jest.mock('aws-sdk', () => {
    return {
        DynamoDB: jest.fn().mockImplementation(() => {
            return {
                putItem: mockPutItem
            };
        }),
        ApiGatewayManagementApi: jest.fn().mockImplementation(() => {
            return {
                postToConnection: mockPostToConnection
            };
        })
    }
});

describe("AWS Lambda function - update_presence", () => {
    // setup Reids commands
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);
    const hset = promisify(redisClient.hset).bind(redisClient);
    const hdel = promisify(redisClient.hdel).bind(redisClient);

    let pgClient;

    beforeAll(async () => {
        process.env = {
            DB_USER: POSTGRES_CONFIG.user,
            DB_HOST: POSTGRES_CONFIG.host,
            DB_DATABASE: POSTGRES_CONFIG.database,
            DB_PASSWORD: POSTGRES_CONFIG.password,
            DB_SSL: POSTGRES_CONFIG.ssl,
            WSS_DOMAIN_NAME: `wss://${WSS_CONFIG.wssDomain}`,
            WSS_STAGE: WSS_CONFIG.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: DYNAMO_DB_CONFIG.userActivityHistoryTable
        };

        // connect to PostgreSQL client
        pgClient = new Client({
            host: POSTGRES_CONFIG.host,
            user: POSTGRES_CONFIG.user,
            database: POSTGRES_CONFIG.database,
            password: POSTGRES_CONFIG.password,
            port: POSTGRES_CONFIG.port
        });
        await pgClient.connect();

        // create PostgreSQL friendship_table
        await pgClient.query(FRIENDSHIP_TABLE_CREATE_SQL);

        // add friendship data
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9)
        `;
        const values = [
            USER_ID1, USER_ID2, new Date(),
            USER_ID3, USER_ID1, new Date(),
            USER_ID4, USER_ID1, new Date()
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // Redis data for user 1
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1, USER_ID1);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID1, CONNECTION_ID1);

        // Redis data for user 2
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID2, USER_ID2);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID2, CONNECTION_ID2);

        // Redis data for user 3
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID3, USER_ID3);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID3, CONNECTION_ID3);

        // User 4 is offline
    });

    afterAll(async () => {
        // drop table
        const text = 'DROP TABLE friendship_table';
        await pgClient.query(text);
        await pgClient.end();
    });

    afterEach(async () => {
        await hdel(REDIS_KEY_PAGE, USER_ID1);
        await hdel(REDIS_KEY_LATEST_PAGE, USER_ID1);
        jest.clearAllMocks();
    });

    it('should export a handler function', () => {
        expect(update_presence).toHaveProperty('handler');
        expect(typeof update_presence.handler).toBe('function');
    });

    it('should update the shared page and latest_page upon update_presence', async () => {
        // 1. Update presence for shared url
        let event = {
            body: JSON.stringify(SHARED_PAGE1),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));

        // 2. Update presence for shared url
        event = {
            body: JSON.stringify(SHARED_PAGE2),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE2));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE2));
    });

    it('should not update the latest page upon update_presence for hidden url', async () => {
        // 1. Update presence for hidden url
        let event = {
            body: JSON.stringify(EMPTY_PAGE),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that only Redis page data is updated for user1
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(EMPTY_PAGE));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBeNull();

        // 2. Update presence for shared url
        event = {
            body: JSON.stringify(SHARED_PAGE1),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        }
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
        
        // 3. Update presence for hidden url
        event = {
            body: JSON.stringify(EMPTY_PAGE),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that only Redis page data is updated for user1
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(EMPTY_PAGE));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
    });

    it('should post message to friends upon update_presence', async () => {
        // 1. Update presence for shared url
        let event = {
            body: JSON.stringify(SHARED_PAGE1),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${WSS_CONFIG.wssDomain}/${WSS_CONFIG.wssStage}`
        });

        // confirm that close_connection data is posted to connected friends
        let messageData = JSON.stringify({
            type: 'update-presence',
            userId: USER_ID1,
            url: SHARED_PAGE1.url,
            title: SHARED_PAGE1.title,
            domain: SHARED_PAGE1_DOMAIN,
            latestUrl: SHARED_PAGE1.url,
            latestTitle: SHARED_PAGE1.title,
            latestDomain: SHARED_PAGE1_DOMAIN
        });
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: CONNECTION_ID2,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: CONNECTION_ID3,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: CONNECTION_ID1,
            Data: messageData
        });
        jest.clearAllMocks();

        // 2. Update presence for hidden url
        event = {
            body: JSON.stringify(EMPTY_PAGE),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that close_connection data is posted to connected friends
        messageData = JSON.stringify({
            type: 'update-presence',
            userId: USER_ID1,
            url: EMPTY_PAGE.url,
            title: EMPTY_PAGE.title,
            domain: '',
            latestUrl: SHARED_PAGE1.url,
            latestTitle: SHARED_PAGE1.title,
            latestDomain: SHARED_PAGE1_DOMAIN
        });
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: CONNECTION_ID2,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: CONNECTION_ID3,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: CONNECTION_ID1,
            Data: messageData
        });
    });

    it('should save UPDATE_PRESENCE user activity to UserActivityHistoryTable', async () => {
        const event = {
            body: JSON.stringify(SHARED_PAGE1),
            requestContext: {
                connectionId: CONNECTION_ID1,
                domainName: WSS_CONFIG.wssDomain,
                stage: WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);

        // confirm that user's CLOSE_CONNECTION activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenCalledWith({
            TableName: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "UPDATE_PRESENCE" },
                url: { S: SHARED_PAGE1.url },
                title: { S: SHARED_PAGE1.title }
            }
        });
    });
});
