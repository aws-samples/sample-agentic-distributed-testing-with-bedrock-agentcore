FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# Vite inlines import.meta.env.VITE_* into the built JS bundle at build time
# (not read at container runtime) — so Cognito config must be passed as
# build args, not `environment` on the ECS task definition. All three are
# optional; when unset, the frontend renders with auth disabled (see
# frontend/src/context/AuthContext.jsx authRequired()). Values come from
# `terraform output cognito_user_pool_id / cognito_client_id /
# cognito_hosted_ui_domain` after `terraform apply` creates the pool — see
# terraform/README.md for the full two-phase deploy flow.
ARG VITE_COGNITO_DOMAIN=""
ARG VITE_COGNITO_CLIENT_ID=""
ARG VITE_COGNITO_USER_POOL_ID=""
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN
ENV VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
ENV VITE_COGNITO_USER_POOL_ID=$VITE_COGNITO_USER_POOL_ID

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
