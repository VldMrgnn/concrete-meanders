declare module "remotedev" {
  export function connectViaExtension(options?: RemoteDevToolsOptions): RemoteDevToolsConnection;
  export default connectViaExtension;
}
