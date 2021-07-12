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

    // A required ID type "ID!"
    const requiredId = AppSync.GraphqlType.id({ isRequired: true });

    // User defined types: enum for presence state and required version (i.e. "status!")
    const status = new AppSync.EnumType("Status", {
        definition: ["online", "offline"]
    });
    const requiredStatus = typeFromObject(status, { isRequired: true });

    const presence = new AppSync.ObjectType("Presence",{
        definition: {
            id: requiredId,
            status: requiredStatus
        },
        directives: [AppSync.Directive.iam(), AppSync.Directive.apiKey()]
    });
    const returnPresence = typeFromObject(presence);

    // Add types to the schema
    schema.addType(status);
    schema.addType(presence);

    // Add queries to the schema
    schema.addQuery("heartbeat", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId }
    }));
    schema.addQuery("status", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId }
    }));

    // Add mutations to the schema
    schema.addMutation("connect", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId }
    }));
    schema.addMutation("disconnect", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId }
    }));
    schema.addMutation("disconnected", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId },
        directives: [ AppSync.Directive.iam() ]
    }));

    // Add subscription to the schema
    schema.addSubscription("onStatus", new AppSync.Field({
        returnType: returnPresence,
        args: { id: requiredId },
        directives: [ AppSync.Directive.subscribe("connect", "disconnected") ]
    }));

    return schema;
};
