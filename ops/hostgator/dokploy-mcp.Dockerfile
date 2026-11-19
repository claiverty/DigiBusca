FROM node:22-alpine AS package
RUN npm install --global --omit=dev @dokploy/mcp@0.30.7

FROM node:22-alpine
COPY --from=package /usr/local/lib/node_modules /usr/local/lib/node_modules
USER 1000:1000
ENTRYPOINT ["node", "/usr/local/lib/node_modules/@dokploy/mcp/build/index.js"]
CMD ["--http"]
