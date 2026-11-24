ARG OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw:2026.11.6@sha256:65e229536a2698f0ab211c8a3d1c5c8e2685d19379d153e95f93ff76f22779cf

FROM ${OPENCLAW_BASE_IMAGE} AS whisper-builder
USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential ca-certificates cmake git curl \
    && rm -rf /var/lib/apt/lists/*

RUN git init /tmp/whisper.cpp \
    && git -C /tmp/whisper.cpp remote add origin https://github.com/ggml-org/whisper.cpp.git \
    && git -C /tmp/whisper.cpp fetch --depth=1 origin 96ec4d9823e9d0211944172da35f9f29134af990 \
    && git -C /tmp/whisper.cpp checkout --detach FETCH_HEAD \
    && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON \
      -DWHISPER_BUILD_IS_DEV=OFF \
      -DGGML_NATIVE=OFF \
    && cmake --build /tmp/whisper.cpp/build --config Release --target whisper-cli --parallel 1

RUN mkdir -p /opt/whisper/models \
    && curl --fail --location --retry 5 --retry-delay 3 \
      --output /opt/whisper/models/ggml-base.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin \
    && echo "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe  /opt/whisper/models/ggml-base.bin" | sha256sum --check

FROM ${OPENCLAW_BASE_IMAGE} AS runtime
USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-builder /tmp/whisper.cpp/build/bin/ /opt/whisper/bin/
COPY --from=whisper-builder /opt/whisper/models/ggml-base.bin /opt/whisper/models/ggml-base.bin
COPY openclaw-workspace/extensions/digibusca-sync/openclaw-whisper-transcribe.sh /usr/local/bin/openclaw-whisper-transcribe

RUN chmod 0755 /usr/local/bin/openclaw-whisper-transcribe

ENV LD_LIBRARY_PATH=/opt/whisper/bin

RUN /opt/whisper/bin/whisper-cli --version

USER node
