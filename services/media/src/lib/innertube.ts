import {
  ClientType,
  Innertube,
  Log,
  Platform,
  UniversalCache,
} from 'youtubei.js';

type VmPrimitive = string | number | boolean | null | undefined;

interface BuildScriptResult {
  output: string;
}

Log.setLevel(Log.Level.ERROR);

let interpreterInstalled = false;
const clients = new Map<ClientType, Promise<Innertube>>();

const installJavascriptInterpreter = (): void => {
  if (interpreterInstalled) {
    return;
  }

  Platform.shim.eval = async (
    data: BuildScriptResult,
    env: Record<string, VmPrimitive>,
  ) => {
    const properties: string[] = [];

    if (env.n) {
      properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
    }

    if (env.sig) {
      properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
    }

    const code = `${data.output}\nreturn { ${properties.join(', ')} };`;
    return new Function(code)() as Record<string, string>;
  };

  interpreterInstalled = true;
};

const getClient = (clientType: ClientType): Promise<Innertube> => {
  installJavascriptInterpreter();

  const existingClient = clients.get(clientType);
  if (existingClient) {
    return existingClient;
  }

  const clientPromise = Innertube.create({
    cache: new UniversalCache(false),
    client_type: clientType,
  }).catch((error: unknown) => {
    clients.delete(clientType);
    throw error;
  });

  clients.set(clientType, clientPromise);
  return clientPromise;
};

export const getPlaybackInnertubeClient = (): Promise<Innertube> => {
  return getClient(ClientType.ANDROID);
};
