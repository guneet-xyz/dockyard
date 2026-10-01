FROM alpine:3.23
RUN apk add --no-cache openssl
COPY deploy/init-certs.sh /init-certs.sh
ENTRYPOINT ["sh", "/init-certs.sh"]
