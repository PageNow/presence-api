const { promisify } = require('util');
const { Client } = require('pg');
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as timeout from '../../src/functions/timeout/timeout';
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

const INACTIVE_TIME_DIFF = 240000; // time difference that is considered as timeout
const ACTIVE_TIME_DIFF = 100000; // time difference that is NOT considered as timeout

describe("AWS Lambda function - timeout", () => {
    // setup Redis commands
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);
    const hset = promisify(redisClient.hset).bind(redisClient);
    const zadd = promisify(redisClient.zadd).bind(redisClient);
    const zscore = promisify(redisClient.zscore).bind(redisClient);

    let pgClient; // PostgreSQL client

    beforeAll(async () => {
        process.env = {
            DB_USER: config.POSTGRES_CONFIG.user,
            DB_HOST: config.POSTGRES_CONFIG.host,
            DB_DATABASE: config.POSTGRES_CONFIG.database,
            DB_PASSWORD: config.POSTGRES_CONFIG.password,
            DB_SSL: config.POSTGRES_CONFIG.ssl,
            WSS_DOMAIN_NAME: `wss://${config.WSS_CONFIG.wssDomain}`,
            WSS_STAGE: config.WSS_CONFIG.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: config.DYNAMO_DB_CONFIG.userActivityHistoryTable,
            TIMEOUT: '180000'
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

        // add friendship: user1 <-> user2, user1 <-> user3, user4 <-> user2
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9),
                ($10, $11, $12)
        `;
        const values = [
            data.USER_ID1, data.USER_ID2, new Date(),
            data.USER_ID3, data.USER_ID1, new Date(),
            data.USER_ID4, data.USER_ID2, new Date(),
            data.USER_ID4, data.USER_ID5, new Date()
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // set Redis connection data for user 1
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1, data.USER_ID1);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1, data.CONNECTION_ID1);
        await hset(constants.REDIS_KEY_PAGE, data.USER_ID1, JSON.stringify(data.SHARED_PAGE1));
        await hset(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1, JSON.stringify(data.LATEST_PAGE1));
        // set Redis connection data for user 2
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID2, data.USER_ID2);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID2, data.CONNECTION_ID2);
        await hset(constants.REDIS_KEY_PAGE, data.USER_ID2, JSON.stringify(data.EMPTY_PAGE));
        await hset(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID2, JSON.stringify(data.LATEST_PAGE1));
        // set Redis connection data for user 3
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID3, data.USER_ID3);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID3, data.CONNECTION_ID3);
        await hset(constants.REDIS_KEY_PAGE, data.USER_ID3, JSON.stringify(data.SHARED_PAGE1));
        await hset(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID3, JSON.stringify(data.LATEST_PAGE1));
        // set Redis connection data for user 4
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID4, data.USER_ID4);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID4, data.CONNECTION_ID4);
        await hset(constants.REDIS_KEY_PAGE, data.USER_ID4, JSON.stringify(data.EMPTY_PAGE));
        await hset(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID4, JSON.stringify(data.LATEST_PAGE1));
    });

    afterAll(async () => {
        // drop table
        const text = 'DROP TABLE friendship_table';
        await pgClient.query(text);
        await pgClient.end();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should export a handler function', () => {
        expect(timeout).toHaveProperty('handler');
        expect(typeof timeout.handler).toBe('function');
    });

    it('should only remove users with stale timestamp', async () => {
        // user1 and user2 are inactive (stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID1);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID2);
        // user3 and user4 are active (not stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID3);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID4);

        await timeout.handler();

        // confirm that the user1 Redis data is removed
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBeNull();
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID1)).resolves.toBeNull();

        // confirm that the user2 Redis data is removed
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID2)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID2)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID2)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID2)).resolves.toBeNull();
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID2)).resolves.toBeNull();

        // confirm that the user3 Redis data is not removed
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID3)).resolves.toBe(data.USER_ID3);
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID3)).resolves.toBe(data.CONNECTION_ID3);
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID3)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID3)).resolves.toBe(JSON.stringify(data.LATEST_PAGE1));
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID3)).resolves.not.toBeNull();

        // confirm that the user4 Redis data is not removed
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID4)).resolves.toBe(data.USER_ID4);
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID4)).resolves.toBe(data.CONNECTION_ID4);
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID4)).resolves.toBe(JSON.stringify(data.EMPTY_PAGE));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID4)).resolves.toBe(JSON.stringify(data.LATEST_PAGE1));
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID4)).resolves.not.toBeNull();
    });

    it('should post messages to friends', async () => {
        // user1 times out => sends message to user2 and user3
        // user4 times out => sends message to user2 but not to user5 who is offline

        // user1 and user4 are inactive (stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID1);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID4);
        // user2 and user3 are active (not stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID2);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID3);

        await timeout.handler();

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${config.WSS_CONFIG.wssDomain}/${config.WSS_CONFIG.wssStage}`
        });

        // confirm that timeout data is posted to connected friends
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: data.CONNECTION_ID2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.USER_ID1
            })
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: data.CONNECTION_ID3,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.USER_ID1
            })
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: data.CONNECTION_ID2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.USER_ID4
            })
        });
    });

    it('should save TIMEOUT event to UserActivityHistoryTable', async () => {
        // user1 and user2 are inactive (stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID1);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, data.USER_ID2);
        // user3 and user4 are active (not stale timestamp)
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID3);
        await zadd(constants.REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, data.USER_ID4);

        await timeout.handler();

        // confirm that the user's TIMEOUT activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(2);
        expect(mockPutItem).toHaveBeenNthCalledWith(1, {
            TableName: config.DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: data.USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "TIMEOUT" }
            }
        });
        expect(mockPutItem).toHaveBeenNthCalledWith(2, {
            TableName: config.DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: data.USER_ID2 },
                timestamp: { S: expect.anything() },
                type: { S: "TIMEOUT" }
            }
        });
    });
});
