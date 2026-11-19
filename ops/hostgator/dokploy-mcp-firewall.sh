#!/usr/bin/env bash
set -euo pipefail

OPS_BRIDGE_IP=172.30.0.2
MCP_BRIDGE_IP=172.30.0.3
MCP_CONTROL_IP=10.0.3.10
CONTROL_CIDR=10.0.3.0/24
CHAIN=DIGIBUSCA-MCP

fail() {
  printf 'digibusca-mcp-firewall: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'run as root'
docker info 2>/dev/null | grep -Eq '^[[:space:]]*Firewall Backend:[[:space:]]*iptables$' || fail 'Docker firewall backend must be iptables'
[[ "$(docker network inspect openbot --format '{{.Driver}}')" == bridge ]] || fail 'openbot must be a bridge network'
[[ "$(docker network inspect openbot --format '{{index .Options "com.docker.network.bridge.name"}}')" == br-openbot ]] || fail 'openbot must use br-openbot'
[[ "$(docker network inspect openbot --format '{{index .Options "com.docker.network.bridge.enable_icc"}}')" == false ]] || fail 'openbot ICC must remain disabled'
[[ "$(docker network inspect openbot --format '{{(index .IPAM.Config 0).Subnet}}')" == 172.30.0.0/16 ]] || fail 'unexpected openbot subnet'
[[ "$(docker network inspect openbot --format '{{.EnableIPv6}}')" == false ]] || fail 'IPv6 must remain disabled on openbot'
[[ "$(docker network inspect digibusca-dokploy-mcp-control --format '{{.Driver}}')" == overlay ]] || fail 'MCP control network must be an overlay'
[[ "$(docker network inspect digibusca-dokploy-mcp-control --format '{{.Internal}}')" == true ]] || fail 'MCP control network must be internal'
[[ "$(docker network inspect digibusca-dokploy-mcp-control --format '{{(index .IPAM.Config 0).Subnet}}')" == "$CONTROL_CIDR" ]] || fail 'unexpected MCP control subnet'
[[ "$(docker network inspect digibusca-dokploy-mcp-control --format '{{.EnableIPv6}}')" == false ]] || fail 'IPv6 must remain disabled on the control network'
[[ "$(sysctl -n net.bridge.bridge-nf-call-iptables)" == 1 ]] || fail 'bridge netfilter for iptables must be enabled'
iptables -S DOCKER-USER >/dev/null 2>&1 || fail 'DOCKER-USER chain is not present'

# Only this owned chain is flushed. Docker and OpenBot chains are left intact.
iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
iptables -A "$CHAIN" -i br-openbot -s "$OPS_BRIDGE_IP" -d "$MCP_BRIDGE_IP" -p tcp --dport 3000 -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
iptables -A "$CHAIN" -i br-openbot -s "$MCP_BRIDGE_IP" -d "$OPS_BRIDGE_IP" -p tcp --sport 3000 -m conntrack --ctstate ESTABLISHED -j ACCEPT
iptables -A "$CHAIN" -s "$CONTROL_CIDR" -d "$MCP_CONTROL_IP" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A "$CHAIN" -d "$MCP_CONTROL_IP" -j DROP
iptables -A "$CHAIN" -s "$MCP_CONTROL_IP" -d "$CONTROL_CIDR" -p tcp --dport 3000 -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT
iptables -A "$CHAIN" -s "$MCP_CONTROL_IP" -d "$CONTROL_CIDR" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A "$CHAIN" -s "$MCP_BRIDGE_IP" -j DROP
iptables -A "$CHAIN" -s "$MCP_CONTROL_IP" -j DROP
iptables -A "$CHAIN" -j RETURN

# Put the dedicated policy before OpenBot's private-network egress filter.
while iptables -C DOCKER-USER -j "$CHAIN" 2>/dev/null; do
  iptables -D DOCKER-USER -j "$CHAIN"
done
iptables -I DOCKER-USER 1 -j "$CHAIN"

# MCP containers must not reach host listeners, even if UFW later allows one.
iptables -C INPUT -s "$MCP_BRIDGE_IP" -j DROP 2>/dev/null || iptables -I INPUT 1 -s "$MCP_BRIDGE_IP" -j DROP
iptables -C INPUT -s "$MCP_CONTROL_IP" -j DROP 2>/dev/null || iptables -I INPUT 1 -s "$MCP_CONTROL_IP" -j DROP

# Neither attached Docker network has IPv6. Keep host listeners on the OpenBot
# bridge unavailable over IPv6 as well; do not change global IPv6 settings.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -C INPUT -i br-openbot -j DROP 2>/dev/null || ip6tables -I INPUT 1 -i br-openbot -j DROP
fi

printf 'digibusca-mcp-firewall: policy installed; Ops %s -> MCP %s:3000; MCP control egress limited to %s:3000\n' \
  "$OPS_BRIDGE_IP" "$MCP_BRIDGE_IP" "$CONTROL_CIDR"
