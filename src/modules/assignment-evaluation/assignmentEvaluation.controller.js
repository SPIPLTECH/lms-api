const service = require("./assignmentEvaluation.service");

const respond = (fn, status = 200) => async (req, res, next) => {
    try {
        const data = await fn(req);
        res.status(status).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getRubric: respond((req) => service.getRubric(req.params.assignmentId)),
    saveRubric: respond((req) => service.saveRubric(req.params.assignmentId, req.body, req.user.id)),
    deleteRubric: respond(async (req) => {
        await service.deleteRubric(req.params.assignmentId);
        return null;
    }),
    previewRubric: respond((req) => service.previewRubric(req.params.assignmentId, req.body.rubric, req.body.answerText)),
    evaluateAll: respond((req) => service.evaluateAll(req.params.assignmentId, req.user.id), 202),

    getEvaluation: respond((req) => service.getEvaluation(req.params.assignmentId, req.params.submissionId)),
    accept: respond((req) => service.accept(req.params.assignmentId, req.params.submissionId, req.user.id, req.body)),
    override: respond((req) => service.override(req.params.assignmentId, req.params.submissionId, req.user.id, req.body)),
    reEvaluate: respond((req) => service.reEvaluate(req.params.assignmentId, req.params.submissionId, req.user.id, req.body), 202),

    listSynonyms: respond(() => service.listSynonyms()),
    addSynonymGroup: respond((req) => service.addSynonymGroup(req.body, req.user.id), 201),
    removeSynonymGroup: respond(async (req) => {
        await service.removeSynonymGroup(req.params.groupId, req.user);
        return null;
    }),
    addStarterSynonyms: respond((req) => service.addStarterSynonyms(req.user.id)),
};
