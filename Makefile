all:
	aws s3 cp index.html s3://archive.openswitch.net/index.html
	aws s3 cp index.js s3://archive.openswitch.net/index.js

.PHONY: all
