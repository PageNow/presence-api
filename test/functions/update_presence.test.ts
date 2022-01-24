const { promisify } = require('util');
import { Client } from 'pg';
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as update_presence from '../../src/functions/update_presence/update_presence';
import * as constants from '../../src/layer/nodejs/constants';
import * as config from '../utils/config';
import * as data from '../utils/data';
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

    let pgClient; // PsotgreSQL client

    beforeAll(async () => {
        process.env = {
            DB_USER: config.POSTGRES_CONFIG.user,
            DB_HOST: config.POSTGRES_CONFIG.host,
            DB_DATABASE: config.POSTGRES_CONFIG.database,
            DB_PASSWORD: config.POSTGRES_CONFIG.password,
            DB_SSL: config.POSTGRES_CONFIG.ssl,
            WSS_DOMAIN_NAME: `wss://${config.WSS_CONFIG.wssDomain}`,
            WSS_STAGE: config.WSS_CONFIG.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: config.DYNAMO_DB_CONFIG.userActivityHistoryTable
        };

        // connect to PostgreSQL client
        pgClient = new Client({
            host: config.POSTGRES_CONFIG.host,
            user: config.POSTGRES_CONFIG.user,
            database: config.POSTGRES_CONFIG.database,
            password: config.POSTGRES_CONFIG.password,
            port: config.POSTGRES_CONFIG.port
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
            data.USER_ID1, data.USER_ID2, new Date(),
            data.USER_ID3, data.USER_ID1, new Date(),
            data.USER_ID4, data.USER_ID1, new Date()
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // Redis data for user 1
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1, data.USER_ID1);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1, data.CONNECTION_ID1);

        // Redis data for user 2
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID2, data.USER_ID2);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID2, data.CONNECTION_ID2);

        // Redis data for user 3
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID3, data.USER_ID3);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID3, data.CONNECTION_ID3);

        // User 4 is offline
    });

    afterAll(async () => {
        // drop table after tests are done
        const text = 'DROP TABLE friendship_table';
        await pgClient.query(text);
        await pgClient.end();
    });

    afterEach(async () => {
        await hdel(constants.REDIS_KEY_PAGE, data.USER_ID1);
        await hdel(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1);
        jest.clearAllMocks();
    });

    it('should export a handler function', () => {
        expect(update_presence).toHaveProperty('handler');
        expect(typeof update_presence.handler).toBe('function');
    });

    it('should update the shared page and latest_page upon update_presence', async () => {
        // 1. Update presence for shared url
        let event = {
            body: JSON.stringify(data.SHARED_PAGE1),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));

        // 2. Update presence for shared url
        event = {
            body: JSON.stringify(data.SHARED_PAGE2),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE2));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE2));
    });

    it('should not update the latest page upon update_presence for hidden url', async () => {
        // 1. Update presence for hidden url
        let event = {
            body: JSON.stringify(data.EMPTY_PAGE),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that only Redis page data is updated for user1
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.EMPTY_PAGE));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBeNull();

        // 2. Update presence for shared url
        event = {
            body: JSON.stringify(data.SHARED_PAGE1),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        }
        await update_presence.handler(event);
        // confirm that Redis page and latest_page data are both updated for user1
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
        
        // 3. Update presence for hidden url
        event = {
            body: JSON.stringify(data.EMPTY_PAGE),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that only Redis page data is updated for user1
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.EMPTY_PAGE));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
    });

    it('should post message to friends upon update_presence', async () => {
        // 1. Update presence for shared url
        let event = {
            body: JSON.stringify(data.SHARED_PAGE1),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${config.WSS_CONFIG.wssDomain}/${config.WSS_CONFIG.wssStage}`
        });

        // confirm that update_presence data is posted to connected friends
        let messageData = JSON.stringify({
            type: 'update-presence',
            userId: data.USER_ID1,
            url: data.SHARED_PAGE1.url,
            title: data.SHARED_PAGE1.title,
            domain: data.SHARED_PAGE1_DOMAIN,
            latestUrl: data.SHARED_PAGE1.url,
            latestTitle: data.SHARED_PAGE1.title,
            latestDomain: data.SHARED_PAGE1_DOMAIN
        });
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: data.CONNECTION_ID2,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: data.CONNECTION_ID3,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: data.CONNECTION_ID1,
            Data: messageData
        });
        jest.clearAllMocks();

        // 2. Update presence for hidden url
        event = {
            body: JSON.stringify(data.EMPTY_PAGE),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);
        // confirm that update_presence data is posted to connected friends
        messageData = JSON.stringify({
            type: 'update-presence',
            userId: data.USER_ID1,
            url: data.EMPTY_PAGE.url,
            title: data.EMPTY_PAGE.title,
            domain: '',
            latestUrl: data.SHARED_PAGE1.url,
            latestTitle: data.SHARED_PAGE1.title,
            latestDomain: data.SHARED_PAGE1_DOMAIN
        });
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: data.CONNECTION_ID2,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: data.CONNECTION_ID3,
            Data: messageData
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: data.CONNECTION_ID1,
            Data: messageData
        });
    });

    it('should save UPDATE_PRESENCE user activity to UserActivityHistoryTable', async () => {
        const event = {
            body: JSON.stringify(data.SHARED_PAGE1),
            requestContext: {
                connectionId: data.CONNECTION_ID1,
                domainName: config.WSS_CONFIG.wssDomain,
                stage: config.WSS_CONFIG.wssStage
            }
        };
        await update_presence.handler(event);

        // confirm that user's UPDATE_PRESENCE activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenCalledWith({
            TableName: config.DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: data.USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "UPDATE_PRESENCE" },
                url: { S: data.SHARED_PAGE1.url },
                title: { S: data.SHARED_PAGE1.title }
            }
        });
    });
});
