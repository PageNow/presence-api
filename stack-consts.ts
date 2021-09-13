require('dotenv').config();

export const cognitoPoolId = process.env.COGNITO_POOL_ID;

export const pagenowVpcId = process.env.VPC_ID;

export const privateRouteTableId = process.env.PRIVATE_ROUTE_TABLE_ID;
export const publicRouteTableId = process.env.PUBLIC_ROUTE_TABLE_ID;

export const subnet1AZ = process.env.SUBNET1_AZ
export const subnet2AZ = process.env.SUBNET2_AZ

export const privateSubnet1Id = process.env.PRIVATE_SUBNET1_ID;
export const privateSubnet2Id = process.env.PRIVATE_SUBNET2_ID;
export const publicSubnet1Id = process.env.PUBLIC_SUBNET1_ID;
export const publicSubnet2Id = process.env.PUBLIC_SUBNET2_ID;

export const rdsSgId = process.env.RDS_SG_ID;
export const rdsProxySgId = process.env.RDS_PROXY_SG_ID;

export const rdsDBName = 'core_db';
export const rdsDBHost = process.env.RDS_HOST;
export const rdsDBUser = process.env.RDS_USERNAME;
export const rdsDBPassword = process.env.RDS_PASSWORD;
export const rdsDBPort = 5432;

export const rdsProxyArn = process.env.RDS_PROXY_ARN;
export const rdsProxyName = process.env.RDS_PROXY_NAME;
