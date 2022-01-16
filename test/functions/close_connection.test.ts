const { promisify } = require('util');
const { Client } = require('pg');
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as close_connection from '../../src/functions/close_connection/close_connection';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER, REDIS_KEY_PAGE,
    REDIS_KEY_LATEST_PAGE, REDIS_KEY_STATUS
} from '../../src/layer/nodejs/constants';

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

const data = {
    connectionId1: 'connectionId1',
    userId1: 'userId1',
    status1: Date.now(),
    page1: {
        url: 'https://www.pagenow.io',
        title: 'PageNow'
    },
    latestPage1: {
        url: 'https://www.noninertialframe.com',
        title: 'Noninertial Frame'
    },
    userId2: 'userId2',
    connectionId2: 'connectionId2',
    userId3: 'userId3',
    connectionId3: 'connectionId3'
};

const dbConfig = {
    user: 'ylee',
    host: 'localhost',
    database: 'test_core_db',
    password: 'password',
    port: 5432,
    ssl: 'false'
};

const wssConfig = {
    wssDomain: 'test.com',
    wssStage: 'dev'
};

const dynamoDBConfig = {
    userActivityHistoryTable: 'UserActivityHistoryTable'
}

describe("AWS Lambda function - close_connection", () => {
    // setup Redis commands
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);
    const hset = promisify(redisClient.hset).bind(redisClient);
    const zadd = promisify(redisClient.zadd).bind(redisClient);
    const zscore = promisify(redisClient.zscore).bind(redisClient);

    let pgClient;

    beforeAll(async () => {
        process.env = {
            DB_USER: dbConfig.user,
            DB_HOST: dbConfig.host,
            DB_DATABASE: dbConfig.database,
            DB_PASSWORD: dbConfig.password,
            DB_SSL: dbConfig.ssl,
            WSS_DOMAIN_NAME: `wss://${wssConfig.wssDomain}`,
            WSS_STAGE: wssConfig.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: dynamoDBConfig.userActivityHistoryTable
        };

        pgClient = new Client({
            host: dbConfig.host,
            user: dbConfig.user,
            database: dbConfig.database,
            password: dbConfig.password,
            port: dbConfig.port,
        });
        await pgClient.connect();

        // create PostgreSQL table
        let text = `
            CREATE TABLE IF NOT EXISTS friendship_table (
                user_id1     VARCHAR(50),
                user_id2     VARCHAR(50),
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at  TIMESTAMP,
                PRIMARY KEY (user_id1, user_id2)
            );
        `;
        await pgClient.query(text);
    
        // add friendship data
        text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6)
        `;
        const values = [
            data.userId1, data.userId2, new Date(),
            data.userId3, data.userId1, new Date(),
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // Redis data for user 1
        await hset(REDIS_KEY_CONNECTION_USER, data.connectionId1, data.userId1);
        await hset(REDIS_KEY_USER_CONNECTION, data.userId1, data.connectionId1);
        await hset(REDIS_KEY_PAGE, data.userId1, JSON.stringify(data.page1));
        await hset(REDIS_KEY_LATEST_PAGE, data.userId1, JSON.stringify(data.latestPage1));
        await zadd(REDIS_KEY_STATUS, data.status1, data.userId1);

        // Redis data for user 2
        await hset(REDIS_KEY_CONNECTION_USER, data.connectionId2, data.userId2);
        await hset(REDIS_KEY_USER_CONNECTION, data.userId2, data.connectionId2);

        // Redis data for user 3
        await hset(REDIS_KEY_CONNECTION_USER, data.connectionId3, data.userId3);
        await hset(REDIS_KEY_USER_CONNECTION, data.userId3, data.connectionId3);
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

    it('exports a handler function', () => {
        expect(close_connection).toHaveProperty('handler');
        expect(typeof close_connection.handler).toBe('function');
    });

    it('should remove user data from Redis', async () => {
        // verify that Redis data is there
        expect(hget(REDIS_KEY_CONNECTION_USER, data.connectionId1)).resolves.toBe(data.userId1);
        expect(hget(REDIS_KEY_USER_CONNECTION, data.userId1)).resolves.toBe(data.connectionId1);
        expect(hget(REDIS_KEY_PAGE, data.userId1)).resolves.toBe(JSON.stringify(data.page1));
        expect(hget(REDIS_KEY_LATEST_PAGE, data.userId1)).resolves.toBe(JSON.stringify(data.latestPage1));
        expect(zscore(REDIS_KEY_STATUS, data.userId1)).resolves.toBe(data.status1.toString());

        const event = {
            requestContext: {
                connectionId: data.connectionId1
            }
        };
        await close_connection.handler(event);

        // confirm that close_connection removes user data from Redis
        await expect(hget(REDIS_KEY_CONNECTION_USER, data.connectionId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_USER_CONNECTION, data.userId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_PAGE, data.userId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_LATEST_PAGE, data.userId1)).resolves.toBe(null);
        await expect(zscore(REDIS_KEY_STATUS, data.userId1)).resolves.toBe(null);
    });

    it('should send message to connected clients', async () => {
        const event = {
            requestContext: {
                connectionId: data.connectionId1
            }
        };
        await close_connection.handler(event);

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${wssConfig.wssDomain}/${wssConfig.wssStage}`
        });

        // confirm that close_connection data is posted to connected friends
        expect(mockPostToConnection).toHaveBeenCalledTimes(2);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: data.connectionId2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.userId1
            })
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: data.connectionId3,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.userId1
            })
        });
    });

    it('should save to DynamoDB', async () => {
        const event = {
            requestContext: {
                connectionId: data.connectionId1
            }
        };
        await close_connection.handler(event);

        // confirm that user's CLOSE_CONNECTION activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenCalledWith({
            TableName: dynamoDBConfig.userActivityHistoryTable,
            Item: {
                user_id: { S: data.userId1 },
                timestamp: { S: expect.anything() },
                type: { S: "CLOSE_CONNECTION" }
            }
        });
    });
});
