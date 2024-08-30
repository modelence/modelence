export abstract class DataModel<RecordType extends object> {
  readonly record: RecordType;

  constructor(record: RecordType) {
    this.record = record;
  }
}
