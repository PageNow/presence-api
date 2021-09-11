const AWS = require('aws-sdk');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

exports.handler = async function(event) {
    
};
