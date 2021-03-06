const { promisify } = require('util');
const redis = require('redis');
const data = require('/opt/nodejs/data');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hset = promisify(redisPresence.hset).bind(redisPresence);

exports.handler = async function(event) {

};
