import {
  emitStorageEvent,
  ProviderInfo,
  ProviderMetadata,
  SkappInfo,
  listenForStorageEvent,
  monitorOtherListener,
  ensureUrl,
} from "skynet-interface-utils";
import urljoin from "url-join";

// Start the bridge pinger in the background.
const { promise: promisePing } = monitorOtherListener("router", "bridge", 5000);

let submitted = false;

let defaultProviders: Array<ProviderInfo> | undefined = undefined;
let skappInfo: SkappInfo | undefined = undefined;

// ======
// Events
// ======

// Event that is triggered when the window is closed by the user.
window.onbeforeunload = () => {
  if (!submitted) {
    // Send value to signify that the router was closed.
    returnMessage("event", "closed");
  }

  return null;
};

window.onerror = function (error) {
  if (typeof error === "string") {
    returnMessage("error", error);
  } else {
    returnMessage("error", error.type);
  }
};

window.onload = async () => {
  // The bridge pinger should run in the background and close the router if the connection with the bridge is lost.
  promisePing.catch(() => {
    returnMessage("error", "Bridge timed out");
  });

  // Get parameters.

  const urlParams = new URLSearchParams(window.location.search);
  const name = urlParams.get("skappName");
  if (!name) {
    returnMessage("error", "Parameter 'skappName' not found");
    return;
  }
  const domain = urlParams.get("skappDomain");
  if (!domain) {
    returnMessage("error", "Parameter 'skappDomain' not found");
    return;
  }
  const defaultProvidersString = urlParams.get("defaultProviders");
  if (!defaultProvidersString) {
    returnMessage("error", "Parameter 'defaultProviders' not found");
    return;
  }

  // Set values.

  // Parse the providers array.
  try {
    defaultProviders = JSON.parse(defaultProvidersString);
  } catch (error) {
    returnMessage("error", `Could not parse 'defaultProviders': ${error}`);
    return;
  }
  if (!defaultProviders) {
    returnMessage("error", "Parameter 'defaultProviders' was null");
    return;
  }
  skappInfo = { name, domain };

  // Set the default providers.

  const uiProviderForm = document.getElementById("provider-form")!;
  // Add the providers in reverse order since we prepend to the form each time.
  let i = 0;
  for (const providerInfo of defaultProviders.reverse()) {
    let radioHtml = `<input type="radio" name="provider-form-radio" value="${providerInfo.domain}"`;
    if (i === defaultProviders.length) {
      radioHtml += ' checked="checked"';
    }
    radioHtml += `/> <label for="identity-test-provider">${providerInfo.name}</label>`;

    const radioDiv = document.createElement("div")!;
    radioDiv.innerHTML = radioHtml;

    // Add div to form.
    uiProviderForm.prepend(radioDiv);
    i++;
  }
};

// ============
// User Actions
// ============

// Function triggered by clicking "OK".
(window as any).submitProvider = async (): Promise<void> => {
  submitted = true;
  deactivateUI();

  // Get the value of the form.

  const radios = document.getElementsByName("provider-form-radio");

  let providerUrl = "";
  for (let i = 0, length = radios.length; i < length; i++) {
    const radio = <HTMLInputElement>radios[i];
    if (radio.checked) {
      providerUrl = radio.value;

      // Only one radio can be logically selected, don't check the rest.
      break;
    }
  }

  // Blank value means we should look at the "Other" field.
  if (providerUrl === "") {
    providerUrl = (<HTMLInputElement>document.getElementById("other-text"))!.value;
  }

  await handleProviderUrl(providerUrl);
};

/**
 * @param providerUrl
 */
async function handleProviderUrl(providerUrl: string): Promise<void> {
  // Event listener that waits for provider metadata from the bridge.
  const { promise: promiseMetadata, controller: controllerMetadata } = listenForStorageEvent("bridge-metadata");
  // Kick off another event listener along with the first one as an error may still occur, and we need to handle that.
  const { promise: promiseLong, controller: controllerLong } = listenForStorageEvent("bridge");

  // eslint-disable-next-line no-async-promise-executor
  const promise: Promise<void> = new Promise(async (resolve, reject) => {
    // Make this promise run in the background and reject on any errors.
    promiseLong.catch((err: string) => {
      reject(err);
    });

    // Send the provider URL to the bridge.

    returnMessage("success", providerUrl, true, "router-provider-url");

    // Wait for provider metadata from bridge.

    try {
      const metadataJSON = await promiseMetadata;
      const metadata = JSON.parse(metadataJSON);
      handleProviderMetadata(metadata);
    } catch (error) {
      returnMessage("error", error);
    }

    resolve();
  });

  return promise.catch((err) => {
    // Clean up the event listeners and promises.
    controllerMetadata.cleanup();
    controllerLong.cleanup();

    returnMessage("error", err);
  });
}

/**
 * @param metadata
 */
function handleProviderMetadata(metadata: ProviderMetadata): void {
  if (!skappInfo) {
    throw new Error("skapp info not found");
  }

  // Open the connector.

  // Build the connector URL.
  let connectorUrl = ensureUrl(metadata.info.domain);
  connectorUrl = urljoin(connectorUrl, metadata.relativeConnectorPath);
  connectorUrl = `${connectorUrl}?skappName=${skappInfo.name}&skappDomain=${skappInfo.domain}`;
  // Navigate to the connector.
  window.location.replace(connectorUrl);
}

// ================
// Helper Functions
// ================

/**
 *
 */
export function activateUI() {
  document.getElementById("darkLayer")!.style.display = "none";
}

/**
 *
 */
export function deactivateUI() {
  document.getElementById("darkLayer")!.style.display = "";
}

/**
 * @param messageKey
 * @param message
 * @param stayOpen
 * @param componentName
 */
function returnMessage(
  messageKey: "success" | "event" | "error",
  message: string,
  stayOpen = false,
  componentName?: string
) {
  let component = "router";
  if (componentName) {
    component = componentName;
  }
  emitStorageEvent(component, messageKey, message);
  if (!stayOpen) {
    window.close();
  }
}
