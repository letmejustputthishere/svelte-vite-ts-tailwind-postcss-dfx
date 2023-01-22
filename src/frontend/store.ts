import { writable, get } from "svelte/store";
import type { Principal } from "@dfinity/principal";
import type { HttpAgent, Identity } from "@dfinity/agent";
import { StoicIdentity } from "ic-stoic-identity";
import { AccountIdentifier, SubAccount } from "@dfinity/nns";
import {
  counter,
  createActor as createCounterActor,
  canisterId as counterCanisterId,
  idlFactory as counterIdlFactory,
} from "../declarations/counter";

export const HOST =
  process.env.DFX_NETWORK !== "ic"
    ? "http://localhost:4943"
    : "https://ic0.app";

type State = {
  isAuthed: "plug" | "stoic" | null;
  counterActor: typeof counter;
  principal: Principal;
  accountId: string;
  error: string;
  isLoading: boolean;
};

const defaultState: State = {
  isAuthed: null,
  counterActor: createCounterActor(counterCanisterId, {
    agentOptions: { host: HOST },
  }),
  principal: null,
  accountId: "",
  error: "",
  isLoading: false,
};

export const createStore = ({
  whitelist,
  host,
}: {
  whitelist?: string[];
  host?: string;
}) => {
  const { subscribe, update } = writable<State>(defaultState);

  const stoicConnect = () => {
    StoicIdentity.load().then(async (identity) => {
      if (identity !== false) {
        // ID is a already connected wallet!
      } else {
        // No existing connection, lets make one!
        identity = await StoicIdentity.connect();
      }
      initStoic(identity);
    });
  };

  const initStoic = async (identity: Identity & { accounts(): string }) => {
    console.trace("initStoic");

    const counterActor = createCounterActor(counterCanisterId, {
      agentOptions: {
        identity,
        host: HOST,
      },
    });

    if (!counterActor) {
      console.warn("couldn't create actors");
      return;
    }

    // the stoic agent provides an `accounts()` method that returns
    // accounts assocaited with the principal
    let accounts = JSON.parse(await identity.accounts());

    update((state) => ({
      ...state,
      counterActor,
      principal: identity.getPrincipal(),
      accountId: accounts[0].address, // we take the default account associated with the identity
      isAuthed: "stoic",
    }));
  };

  const plugConnect = async () => {
    // check if plug is installed in the browser
    if (window.ic?.plug === undefined) {
      window.open("https://plugwallet.ooo/", "_blank");
      return;
    }

    // check if plug is connected
    const plugConnected = await window.ic?.plug?.isConnected();
    if (!plugConnected) {
      try {
        console.log({
          whitelist,
          host,
        });
        await window.ic?.plug.requestConnect({
          whitelist,
          host,
        });
        console.log("plug connected");
      } catch (e) {
        console.warn(e);
        return;
      }
    }

    await initPlug();
  };

  const initPlug = async () => {
    // check wether agent is present
    // if not create it
    if (!window.ic?.plug?.agent) {
      console.warn("no agent found");
      const result = await window.ic?.plug?.createAgent({
        whitelist,
        host,
      });
      result
        ? console.log("agent created")
        : console.warn("agent creation failed");
    }
    // check of if createActor method is available
    if (!window.ic?.plug?.createActor) {
      console.warn("no createActor found");
      return;
    }

    // Fetch root key for certificate validation during development
    if (process.env.DFX_NETWORK !== "ic") {
      window.ic.plug.agent.fetchRootKey().catch((err) => {
        console.warn(
          "Unable to fetch root key. Check to ensure that your local replica is running",
        );
        console.error(err);
      });
    }

    const counterActor = (await window.ic?.plug.createActor({
      canisterId: counterCanisterId,
      interfaceFactory: counterIdlFactory,
    })) as typeof counter;

    if (!counter) {
      console.warn("couldn't create actors");
      return;
    }

    const principal = await window.ic.plug.agent.getPrincipal();

    update((state) => ({
      ...state,
      counterActor,
      principal,
      accountId: window.ic.plug.sessionManager.sessionData.accountId,
      isAuthed: "plug",
    }));

    console.log("plug is authed");
  };

  const disconnect = async () => {
    console.log("disconnected");
    StoicIdentity.disconnect();
    window.ic?.plug?.disconnect();
    // wait for 500ms to ensure that the disconnection is complete
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log("plug status: ", await window.ic?.plug?.isConnected());

    update((prevState) => {
      return {
        ...defaultState,
      };
    });
  };

  return {
    subscribe,
    update,
    plugConnect,
    stoicConnect,
    disconnect,
  };
};

export const store = createStore({
  whitelist: [counterCanisterId],
  host: HOST,
});

declare global {
  interface Window {
    ic: {
      plug: {
        agent: HttpAgent;
        sessionManager: {
          sessionData: {
            accountId: string;
          };
        };
        getPrincipal: () => Promise<Principal>;
        deleteAgent: () => void;
        requestConnect: (options?: {
          whitelist?: string[];
          host?: string;
        }) => Promise<any>;
        createActor: (options: {}) => Promise<typeof counter>;
        isConnected: () => Promise<boolean>;
        disconnect: () => Promise<boolean>;
        createAgent: (args?: {
          whitelist: string[];
          host?: string;
        }) => Promise<undefined>;
        requestBalance: () => Promise<
          Array<{
            amount: number;
            canisterId: string | null;
            image: string;
            name: string;
            symbol: string;
            value: number | null;
          }>
        >;
        requestTransfer: (arg: {
          to: string;
          amount: number;
          opts?: {
            fee?: number;
            memo?: string;
            from_subaccount?: number;
            created_at_time?: {
              timestamp_nanos: number;
            };
          };
        }) => Promise<{ height: number }>;
      };
    };
  }
}
