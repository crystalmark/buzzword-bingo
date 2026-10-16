// Where games are kept. One DynamoDB item per game (sk GAME) and one per player (sk P#<id>), all under the game's code,
// so a game and everyone in it is one Query. Items carry `expires` (epoch seconds), DynamoDB's TTL attribute, so old
// games clear themselves away. memoryStore does the same in a Map, for the tests and the local server.

const GAME = 'GAME';
const P = 'P#';

export function memoryStore() {
  const games = new Map();
  const copy = v => structuredClone(v);
  return {
    async createGame(code, game) {
      if (games.has(code)) return false;
      games.set(code, { game: copy(game), players: new Map() });
      return true;
    },
    async load(code) {
      const g = games.get(code);
      if (!g || g.game.expires * 1000 < Date.now()) return null;
      return { game: copy(g.game), players: [...g.players.values()].map(copy) };
    },
    async putPlayer(code, player) {
      games.get(code).players.set(player.id, copy(player));
    },
    async updatePlayer(code, id, patch) {
      const p = games.get(code).players.get(id);
      Object.assign(p, copy(patch));
    },
    async updateGame(code, patch) {
      Object.assign(games.get(code).game, copy(patch));
    },
  };
}

export async function dynamoStore(table) {
  // The SDK comes with the Lambda runtime, so it isn't a dependency; imported here so the tests never need it
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

  const update = (code, sk, patch) => {
    const keys = Object.keys(patch);
    return db.send(new UpdateCommand({
      TableName: table,
      Key: { pk: code, sk },
      UpdateExpression: 'SET ' + keys.map((k, i) => `#k${i} = :v${i}`).join(', '),
      ExpressionAttributeNames: Object.fromEntries(keys.map((k, i) => [`#k${i}`, k])),
      ExpressionAttributeValues: Object.fromEntries(keys.map((k, i) => [`:v${i}`, patch[k]])),
      ConditionExpression: 'attribute_exists(pk)',
    }));
  };
  const strip = ({ pk, sk, ...rest }) => rest;

  return {
    async createGame(code, game) {
      try {
        await db.send(new PutCommand({
          TableName: table, Item: { pk: code, sk: GAME, ...game }, ConditionExpression: 'attribute_not_exists(pk)',
        }));
        return true;
      } catch (e) {
        if (e.name === 'ConditionalCheckFailedException') return false;
        throw e;
      }
    },
    async load(code) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const r = await db.send(new QueryCommand({
          TableName: table, KeyConditionExpression: 'pk = :c', ExpressionAttributeValues: { ':c': code },
          ConsistentRead: true, ExclusiveStartKey,
        }));
        items.push(...r.Items);
        ExclusiveStartKey = r.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      const game = items.find(i => i.sk === GAME);
      // TTL deletion can lag by a day or two, so an expired game is treated as gone straight away
      if (!game || game.expires * 1000 < Date.now()) return null;
      return { game: strip(game), players: items.filter(i => i.sk.startsWith(P)).map(strip) };
    },
    async putPlayer(code, player) {
      await db.send(new PutCommand({ TableName: table, Item: { pk: code, sk: P + player.id, ...player } }));
    },
    updatePlayer: (code, id, patch) => update(code, P + id, patch),
    updateGame: (code, patch) => update(code, GAME, patch),
  };
}
