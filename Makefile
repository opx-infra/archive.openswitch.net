all:
	aws s3 cp index.html s3://archive-openswitch-net/index.html

.PHONY: all
