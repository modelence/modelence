export default {
  "nested": {
    "prometheus": {
      "nested": {
        "WriteRequest": {
          "fields": {
            "timeseries": {
              "rule": "repeated",
              "type": "TimeSeries",
              "id": 1
            },
            "metadata": {
              "rule": "repeated",
              "type": "MetricMetadata",
              "id": 3
            }
          }
        },
        "ReadRequest": {
          "fields": {
            "queries": {
              "rule": "repeated",
              "type": "Query",
              "id": 1
            },
            "accepted_response_types": {
              "rule": "repeated",
              "type": "ResponseType",
              "id": 2
            }
          },
          "nested": {
            "ResponseType": {
              "values": {
                "SAMPLES": 0,
                "STREAMED_XOR_CHUNKS": 1
              }
            }
          }
        },
        "ReadResponse": {
          "fields": {
            "results": {
              "rule": "repeated",
              "type": "QueryResult",
              "id": 1
            }
          }
        },
        "ChunkedReadResponse": {
          "fields": {
            "chunked_series": {
              "rule": "repeated",
              "type": "ChunkedSeries",
              "id": 1
            },
            "query_index": {
              "type": "int64",
              "id": 2
            }
          }
        },
        "Query": {
          "fields": {
            "start_timestamp_ms": {
              "type": "int64",
              "id": 1
            },
            "end_timestamp_ms": {
              "type": "int64",
              "id": 2
            },
            "matchers": {
              "rule": "repeated",
              "type": "LabelMatcher",
              "id": 3
            },
            "hints": {
              "type": "ReadHints",
              "id": 4
            }
          }
        },
        "QueryResult": {
          "fields": {
            "timeseries": {
              "rule": "repeated",
              "type": "TimeSeries",
              "id": 1
            }
          }
        },
        "MetricMetadata": {
          "fields": {
            "type": {
              "type": "MetricType",
              "id": 1
            },
            "metric_family_name": {
              "type": "string",
              "id": 2
            },
            "help": {
              "type": "string",
              "id": 4
            },
            "unit": {
              "type": "string",
              "id": 5
            }
          },
          "nested": {
            "MetricType": {
              "values": {
                "UNKNOWN": 0,
                "COUNTER": 1,
                "GAUGE": 2,
                "HISTOGRAM": 3,
                "GAUGEHISTOGRAM": 4,
                "SUMMARY": 5,
                "INFO": 6,
                "STATESET": 7
              }
            }
          }
        },
        "Sample": {
          "fields": {
            "value": {
              "type": "double",
              "id": 1
            },
            "timestamp": {
              "type": "int64",
              "id": 2
            }
          }
        },
        "Exemplar": {
          "fields": {
            "labels": {
              "rule": "repeated",
              "type": "Label",
              "id": 1
            },
            "value": {
              "type": "double",
              "id": 2
            },
            "timestamp": {
              "type": "int64",
              "id": 3
            }
          }
        },
        "Histogram": {
          "fields": {
            "count_int": {
              "type": "uint64",
              "id": 1,
              "oneof": "count"
            },
            "count_float": {
              "type": "double",
              "id": 2,
              "oneof": "count"
            },
            "sum": {
              "type": "double",
              "id": 3
            },
            "schema": {
              "type": "sint32",
              "id": 4
            },
            "zero_threshold": {
              "type": "double",
              "id": 5
            },
            "zero_count_int": {
              "type": "uint64",
              "id": 6,
              "oneof": "zero_count"
            },
            "zero_count_float": {
              "type": "double",
              "id": 7,
              "oneof": "zero_count"
            },
            "negative_spans": {
              "rule": "repeated",
              "type": "BucketSpan",
              "id": 8
            },
            "negative_deltas": {
              "rule": "repeated",
              "type": "sint64",
              "id": 9
            },
            "negative_counts": {
              "rule": "repeated",
              "type": "double",
              "id": 10
            },
            "positive_spans": {
              "rule": "repeated",
              "type": "BucketSpan",
              "id": 11
            },
            "positive_deltas": {
              "rule": "repeated",
              "type": "sint64",
              "id": 12
            },
            "positive_counts": {
              "rule": "repeated",
              "type": "double",
              "id": 13
            },
            "reset_hint": {
              "type": "ResetHint",
              "id": 14
            },
            "timestamp": {
              "type": "int64",
              "id": 15
            }
          },
          "nested": {
            "ResetHint": {
              "values": {
                "UNKNOWN": 0,
                "YES": 1,
                "NO": 2,
                "GAUGE": 3
              }
            }
          }
        },
        "BucketSpan": {
          "fields": {
            "offset": {
              "type": "sint32",
              "id": 1
            },
            "length": {
              "type": "uint32",
              "id": 2
            }
          }
        },
        "TimeSeries": {
          "fields": {
            "labels": {
              "rule": "repeated",
              "type": "Label",
              "id": 1
            },
            "samples": {
              "rule": "repeated",
              "type": "Sample",
              "id": 2
            },
            "exemplars": {
              "rule": "repeated",
              "type": "Exemplar",
              "id": 3
            },
            "histograms": {
              "rule": "repeated",
              "type": "Histogram",
              "id": 4
            }
          }
        },
        "Label": {
          "fields": {
            "name": {
              "type": "string",
              "id": 1
            },
            "value": {
              "type": "string",
              "id": 2
            }
          }
        },
        "LabelMatcher": {
          "fields": {
            "type": {
              "type": "Type",
              "id": 1
            },
            "name": {
              "type": "string",
              "id": 2
            },
            "value": {
              "type": "string",
              "id": 3
            }
          },
          "nested": {
            "Type": {
              "values": {
                "EQ": 0,
                "NEQ": 1,
                "RE": 2,
                "NRE": 3
              }
            }
          }
        },
        "ReadHints": {
          "fields": {
            "step_ms": {
              "type": "int64",
              "id": 1
            },
            "func": {
              "type": "string",
              "id": 2
            },
            "start_ms": {
              "type": "int64",
              "id": 3
            },
            "end_ms": {
              "type": "int64",
              "id": 4
            },
            "grouping": {
              "rule": "repeated",
              "type": "string",
              "id": 5
            },
            "by": {
              "type": "bool",
              "id": 6
            },
            "range_ms": {
              "type": "int64",
              "id": 7
            }
          }
        },
        "Chunk": {
          "fields": {
            "min_time_ms": {
              "type": "int64",
              "id": 1
            },
            "max_time_ms": {
              "type": "int64",
              "id": 2
            },
            "type": {
              "type": "Encoding",
              "id": 3
            },
            "data": {
              "type": "bytes",
              "id": 4
            }
          },
          "nested": {
            "Encoding": {
              "values": {
                "UNKNOWN": 0,
                "XOR": 1,
                "HISTOGRAM": 2,
                "FLOAT_HISTOGRAM": 3
              }
            }
          }
        },
        "ChunkedSeries": {
          "fields": {
            "labels": {
              "rule": "repeated",
              "type": "Label",
              "id": 1
            },
            "chunks": {
              "rule": "repeated",
              "type": "Chunk",
              "id": 2
            }
          }
        }
      }
    }
  }
};
