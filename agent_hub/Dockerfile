ARG BUILD_FROM
FROM $BUILD_FROM

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY run.sh /
COPY daemon.py .
COPY web/ ./web/

RUN chmod +x /run.sh

CMD ["/run.sh"]
