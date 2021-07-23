import * as AppSync from '@aws-cdk/aws-appsync';


/**
 * Defines a GraphQL Type from an intermediate type
 * 
 * @param intermediateType - the intermediate type this type derives from
 * @param options - possible values are 'isRequired', 'isList', 'isRequiredList'
 */
const typeFromObject = (
    intermediateType: AppSync.IIntermediateType,
    options?: AppSync.GraphqlTypeOptions
): AppSync.GraphqlType => {
    return AppSync.GraphqlType.intermediate({ intermediateType, ...options });
};


/**
 * Function called to return the schema
 */
export const PresenceSchema = (): AppSync.Schema => {

    // Instantiate the schema
    const schema = new AppSync.Schema();

    // AppSync response (presence) is consisted of userId, status (offline, online),
    // url, and title.
    // In redis_presence, {userId: timestamp} is saved.
    // In redis_status, stringified JSON of {userId: "{url: '', title: ''}"} is saved.

    // A required ID type "ID!"
    const requiredId = AppSync.GraphqlType.id({ isRequired: true });

    // User defined types: enum for presence state, and required version (i.e. "status!")
    const status = new AppSync.EnumType("Status", {
        definition: ["online", "offline"]
    });
    const requiredStatus = typeFromObject(status, { isRequired: true });

    const requiredUrl = AppSync.GraphqlType.string({ isRequired: true });
    const requiredTitle = AppSync.GraphqlType.string({ isRequired: true });

    const presence = new AppSync.ObjectType("Presence", {
        definition: {
            userId: requiredId,
            status: requiredStatus,
            url: requiredUrl,
            title: requiredTitle
        },
        directives: [AppSync.Directive.custom('@aws_cognito_user_pools'), AppSync.Directive.iam()]
    });
    const returnPresence = typeFromObject(presence);

    // Add types to the schema
    schema.addType(status);
    schema.addType(presence);

    // Add queries to the schema
    schema.addQuery("heartbeat", new AppSync.Field({
        returnType: returnPresence
    }));
    schema.addQuery("status", new AppSync.Field({
        returnType: returnPresence,
        args: {
            userId: requiredId
        }
    }));

    // Add mutations to the schema
    schema.addMutation("connect", new AppSync.Field({
        returnType: returnPresence,
        args: {
            url: requiredUrl,
            title: requiredTitle   
        }
    }));
    schema.addMutation("disconnect", new AppSync.Field({
        returnType: returnPresence
    }));
    schema.addMutation("disconnected", new AppSync.Field({
        returnType: returnPresence,
        args: { userId: requiredId },
        directives: [ AppSync.Directive.iam() ]
    }));

    // Add subscription to the schema
    schema.addSubscription("onStatus", new AppSync.Field({
        returnType: returnPresence,
        args: { userId: requiredId },
        directives: [ AppSync.Directive.subscribe("connect", "disconnected") ]
    }));

    return schema;
};

/**
 * References
 * 
 * https://github.com/aws/aws-cdk/issues/12981
 */
