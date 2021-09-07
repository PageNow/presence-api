require('dotenv').config();

export const userPoolId = process.env.USER_POOL_ID;

export const pagenowVpcId = process.env.VPC_ID;

export const rdsSgId = process.env.RDS_SG_ID;
export const rdsProxySgId = process.env.RDS_PROXY_SG_ID;

export const rdsDBName = 'core_db';
export const rdsDBHost = process.env.RDS_HOST;
export const rdsDBUser = process.env.RDS_USERNAME;
export const rdsDBPassword = process.env.DB_PASSWORD;
export const rdsDBPort = 5432;

export const rdsProxyArn = process.env.RDS_PROXY_ARN;
export const rdsProxyName = process.env.RDS_PROXY_NAME;
