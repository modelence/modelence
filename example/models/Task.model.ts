import { DataModel } from 'modelence/data';

type Task = {
  title: string;
  isCompleted: boolean;
};

class TaskModel extends DataModel<Task> {
  getTitle() {
    return this.record.title;
  }

  isCompleted() {
    return this.record.isCompleted;
  }
} 

export default TaskModel;
